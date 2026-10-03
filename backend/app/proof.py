"""Civic proof: a plan hash recorded in a Solana devnet Memo transaction. It proves the record was not altered later,
not that the plan is good."""

import asyncio
import base64
import hashlib
import json
from typing import Any

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.transaction import Transaction

from .config import SOLANA_PAYER_SECRET_KEY, SOLANA_RPC_URL, CityId, LaxInt, log, redact

router = APIRouter()

MEMO_PROGRAM_ID = Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
LAMPORTS_PER_SOL = 1_000_000_000
TOTAL_TIMEOUT_SECONDS = 40  # the frontend aborts proof requests at 45 s


def _load_payer() -> Keypair | None:
    raw = SOLANA_PAYER_SECRET_KEY
    if not raw:
        return None
    try:
        if raw.startswith("["):
            key = bytes(json.loads(raw))
            return Keypair.from_seed(key) if len(key) == 32 else Keypair.from_bytes(key)
        return Keypair.from_base58_string(raw)
    except Exception:
        log.warning("SOLANA_PAYER_SECRET_KEY could not be parsed (expected a JSON array of 64 ints or base58)")
        return None


PAYER = _load_payer()


class ProofRequest(BaseModel):
    cityId: CityId
    score: LaxInt
    playerName: str = ""
    plan: dict[str, Any] = Field(default_factory=dict)


class RpcError(Exception):
    pass


async def _rpc(client: httpx.AsyncClient, method: str, *params: Any) -> Any:
    r = await client.post(SOLANA_RPC_URL, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": list(params)})
    try:
        data = r.json()
    except ValueError:
        raise RpcError(f"{method}: HTTP {r.status_code}") from None
    if isinstance(data, dict) and data.get("error"):
        error = data["error"]
        raise RpcError(f"{method}: {error.get('message', error) if isinstance(error, dict) else error}")
    if r.status_code != 200 or not isinstance(data, dict) or "result" not in data:
        raise RpcError(f"{method}: HTTP {r.status_code}")
    return data["result"]


async def _balance(client: httpx.AsyncClient, payer: Pubkey) -> int:
    return (await _rpc(client, "getBalance", str(payer), {"commitment": "confirmed"}))["value"]


async def _airdrop(client: httpx.AsyncClient, payer: Pubkey) -> None:
    try:
        await _rpc(client, "requestAirdrop", str(payer), LAMPORTS_PER_SOL)
    except RpcError as e:
        raise RpcError(f"payer {payer} has 0 SOL; fund it at https://faucet.solana.com (devnet airdrop failed: {e})") from None
    for _ in range(20):
        await asyncio.sleep(1)
        if await _balance(client, payer) > 0:
            return
    raise RpcError(f"airdrop to payer {payer} did not arrive in time; try again")


async def _send_memo(client: httpx.AsyncClient, signer: Keypair, memo: str) -> str:
    payer = signer.pubkey()
    if await _balance(client, payer) == 0:
        await _airdrop(client, payer)
    latest = await _rpc(client, "getLatestBlockhash", {"commitment": "confirmed"})
    blockhash = Hash.from_string(latest["value"]["blockhash"])
    memo_ix = Instruction(MEMO_PROGRAM_ID, memo.encode(), [AccountMeta(payer, is_signer=True, is_writable=False)])
    tx = Transaction([signer], Message.new_with_blockhash([memo_ix], payer, blockhash), blockhash)
    signature: str = await _rpc(
        client,
        "sendTransaction",
        base64.b64encode(bytes(tx)).decode(),
        {"encoding": "base64", "preflightCommitment": "confirmed"},
    )
    # Wait briefly for confirmation so the explorer link resolves when the player clicks it.
    for _ in range(30):
        status = (await _rpc(client, "getSignatureStatuses", [signature]))["value"][0]
        if status and status.get("err"):
            raise RpcError(f"transaction failed on-chain: {status['err']}")
        if status and status.get("confirmationStatus") in ("confirmed", "finalized"):
            break
        await asyncio.sleep(0.5)
    return signature


@router.post("/api/proof")
async def proof(body: ProofRequest) -> dict[str, Any]:
    canonical = json.dumps(
        {"cityId": body.cityId, "score": body.score, "plan": body.plan},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    digest = hashlib.sha256(canonical.encode()).hexdigest()
    if PAYER is None:
        return {"hash": digest, "error": "Solana payer key is not configured"}
    try:
        async with asyncio.timeout(TOTAL_TIMEOUT_SECONDS), httpx.AsyncClient(timeout=15) as client:
            signature = await _send_memo(client, PAYER, f"faultline:v1:{body.cityId}:{body.score}:{digest}")
    except TimeoutError:
        error = f"Solana devnet did not respond within {TOTAL_TIMEOUT_SECONDS} s"
    except RpcError as e:
        error = redact(e)
    except httpx.HTTPError as e:
        error = f"Solana RPC is unreachable ({type(e).__name__})"
    except Exception as e:
        error = redact(f"Solana proof failed ({type(e).__name__}: {e})")
    else:
        return {"hash": digest, "signature": signature, "explorerUrl": f"https://explorer.solana.com/tx/{signature}?cluster=devnet"}
    log.warning("proof not recorded: %s", error)
    return {"hash": digest, "error": error}
