// Shared GLSL for the world's shaders: hashes and value noise with analytic derivatives
// (no texture fetches), so surfaces can move without any per-frame data.
export const NOISE_GLSL = /* glsl */ `\
float world_hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
// Value noise and its gradient (Inigo Quilez): .x value in 0..1, .yz d/dx, d/dy.
vec3 world_noised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = world_hash(i);
  float b = world_hash(i + vec2(1.0, 0.0));
  float c = world_hash(i + vec2(0.0, 1.0));
  float d = world_hash(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
float world_noise(vec2 p) {
  return world_noised(p).x;
}
`;
