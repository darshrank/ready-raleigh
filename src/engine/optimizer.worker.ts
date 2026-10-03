/// <reference lib="webworker" />
// Finds the optimal plan off the main thread while players plan.
import { FloodModel } from './flood'
import { optimize } from './optimize'
import { loadWorld } from './world'

self.onmessage = async () => {
  try {
    const world = await loadWorld()
    const model = new FloodModel(world)
    const res = optimize(model, (p, msg) => self.postMessage({ t: 'progress', p, msg }))
    self.postMessage({ t: 'done', result: res })
  } catch (e) {
    self.postMessage({ t: 'error', message: String(e) })
  }
}
