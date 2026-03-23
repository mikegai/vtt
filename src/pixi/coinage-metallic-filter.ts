import { Filter, GlProgram, GpuProgram, UniformGroup } from 'pixi.js'

/** Same vertex as Pixi default filter quad (`filters/defaults/defaultFilter.vert`). */
const DEFAULT_FILTER_VERT = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`

const METALLIC_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uMetal;

void main()
{
    vec4 color = texture(uTexture, vTextureCoord);
    vec2 uv = vTextureCoord;
    float wave = sin((uv.x * 1.1 + uv.y * 1.4) * 70.0) * 0.5 + 0.5;
    float spec = pow(wave, 6.0) * uMetal.w;
    float fres = pow(clamp(1.0 - abs(uv.y - 0.5) * 1.15, 0.0, 1.0), 2.0) * 0.2;

    if (color.a > 0.0) {
        color.rgb /= color.a;
        color.rgb *= uMetal.rgb;
        color.rgb += vec3(spec * 0.9);
        color.rgb += color.rgb * fres;
        color.rgb = clamp(color.rgb, 0.0, 1.0);
        color.rgb *= color.a;
    }
    finalColor = color;
}
`

/** WGSL: same filter I/O layout as other Pixi filters (see `noise.wgsl`). */
const METALLIC_WGSL = `
struct GlobalFilterUniforms {
  uInputSize:vec4<f32>,
  uInputPixel:vec4<f32>,
  uInputClamp:vec4<f32>,
  uOutputFrame:vec4<f32>,
  uGlobalFrame:vec4<f32>,
  uOutputTexture:vec4<f32>,
};

struct MetalUniforms {
  uMetal: vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

@group(1) @binding(0) var<uniform> metalUniforms : MetalUniforms;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>
  };

fn filterVertexPosition(aPosition:vec2<f32>) -> vec4<f32>
{
    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;

    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord( aPosition:vec2<f32> ) -> vec2<f32>
{
    return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(
  @location(0) aPosition : vec2<f32>,
) -> VSOutput {
  return VSOutput(
   filterVertexPosition(aPosition),
   filterTextureCoord(aPosition)
  );
}

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>,
) -> @location(0) vec4<f32> {
    var color = textureSample(uTexture, uSampler, uv);
    var um = metalUniforms.uMetal;
    var wave = sin((uv.x * 1.1 + uv.y * 1.4) * 70.0) * 0.5 + 0.5;
    var spec = pow(wave, 6.0) * um.w;
    var fres = pow(clamp(1.0 - abs(uv.y - 0.5) * 1.15, 0.0, 1.0), 2.0) * 0.2;

    if (color.a > 0.0) {
        color = vec4(color.rgb / color.a, color.a);
        color = vec4(color.rgb * um.rgb, color.a);
        color = vec4(color.rgb + vec3(spec * 0.9), color.a);
        color = vec4(color.rgb + color.rgb * fres, color.a);
        color = vec4(clamp(color.rgb, vec3(0.0), vec3(1.0)) * color.a, color.a);
    }
    return color;
}
`

let glProgram: GlProgram | null = null
let gpuProgram: GpuProgram | null = null

const getPrograms = (): { glProgram: GlProgram; gpuProgram: GpuProgram } => {
  if (!glProgram || !gpuProgram) {
    glProgram = GlProgram.from({
      vertex: DEFAULT_FILTER_VERT,
      fragment: METALLIC_FRAG,
      name: 'coinage-metallic-filter',
    })
    gpuProgram = GpuProgram.from({
      name: 'coinage-metallic-filter',
      vertex: {
        source: METALLIC_WGSL,
        entryPoint: 'mainVertex',
      },
      fragment: {
        source: METALLIC_WGSL,
        entryPoint: 'mainFragment',
      },
    })
  }
  return { glProgram, gpuProgram }
}

/**
 * Brushed-metal post-process for pooled coin/gem segment fills (WebGL + WebGPU).
 * `blendHex` is the same blended body color from {@link blendFillColorFromMetals}.
 */
export const createCoinageMetallicFilter = (blendHex: number, specStrength = 0.42): Filter => {
  const r = ((blendHex >> 16) & 0xff) / 255
  const g = ((blendHex >> 8) & 0xff) / 255
  const b = (blendHex & 0xff) / 255
  const { glProgram: gl, gpuProgram: gpu } = getPrograms()
  return new Filter({
    glProgram: gl,
    gpuProgram: gpu,
    resources: {
      metalUniforms: new UniformGroup({
        uMetal: { value: [r, g, b, specStrength], type: 'vec4<f32>' },
      }),
    },
  })
}
