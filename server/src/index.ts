import { buildServer } from './app';

const port = Number(process.env.PORT ?? 8787);
const app = buildServer();

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
