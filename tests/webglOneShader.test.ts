import { describe, expect, it } from "vitest";
import { webglOneShaderErrors } from "../src/lib/generativeArtwork";

const shader = (body: string) => "const fragmentSrc = `precision highp float; void main(){ " + body + " }`;";

describe("webglOneShaderErrors", () => {
  it("détecte le modulo entier de GLSL ES 1.00 (œuvre #9, canevas noir)", () => {
    expect(webglOneShaderErrors(shader("float ix = float(i%10);")).length).toBe(1);
  });
  it("laisse passer mod() et un shader WebGL2", () => {
    expect(webglOneShaderErrors(shader("float ix = mod(float(i), 10.0);"))).toEqual([]);
    expect(webglOneShaderErrors("const s = `#version 300 es\nprecision highp float; void main(){ int a = i % 10; }`;")).toEqual([]);
  });
  it("ignore le modulo du JavaScript et les commentaires GLSL", () => {
    expect(webglOneShaderErrors("const k = i % 10; function f(){ return t % 3; }")).toEqual([]);
    expect(webglOneShaderErrors(shader("// i % 10\n gl_FragColor = vec4(1.0);"))).toEqual([]);
  });
});
