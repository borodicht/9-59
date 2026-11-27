// «Живой» огонь: синемаграф поверх фотографии.
// WebGL оживляет пламя на самом снимке (колыхание, дрожь жара, вспышки яркости),
// второй слой — искры, третий — мерцающий свет камина на всю комнату.
// Всё синхронизировано одной функцией мерцания.

const IMAGE_SIZE = { width: 1717, height: 916 };

// Участок картинки, где живёт огонь (доли ширины/высоты снимка).
const FIRE_CROP = { x0: 0.465, y0: 0.47, x1: 0.615, y1: 0.775 };
// Пламя: центр, ширина и вертикальные границы; ниже GRATE_Y — решётка, её не трогаем.
const FLAME = { cx: 0.539, halfWidth: 0.05, top: 0.575, base: 0.742 };
const GRATE_Y = 0.726;
// Откуда светит камин — для света на комнату и для искр.
const LIGHT = { x: 0.539, y: 0.69 };

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  vUv.y = 1.0 - vUv.y;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform vec4 uCrop;
uniform float uTime;
uniform float uFlicker;
uniform vec4 uFlame;   // cx, halfWidth, top, base
uniform float uGrate;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

float luminance(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = mix(uCrop.xy, uCrop.zw, vUv);
  vec3 original = texture2D(uImage, uv).rgb;

  // Насколько точка внутри языков пламени (по горизонтали — гаусс, по вертикали — от углей вверх).
  float dx = (uv.x - uFlame.x) / uFlame.y;
  float horizontal = exp(-dx * dx * 1.6);
  float height = clamp((uFlame.w - uv.y) / (uFlame.w - uFlame.z), 0.0, 1.0);
  float aboveGrate = 1.0 - smoothstep(uGrate - 0.012, uGrate, uv.y);
  float zone = horizontal * aboveGrate;

  // Языки пламени тянутся вверх: смещение растёт с высотой.
  vec2 flow = vec2(uv.x * 38.0, uv.y * 22.0 + uTime * 2.4);
  float wobbleX = fbm(flow) - 0.5;
  float wobbleY = fbm(flow + vec2(7.3, 2.1)) - 0.5;
  vec2 offset = vec2(wobbleX * 0.010, wobbleY * 0.016 + 0.004) * (0.25 + height * 1.1) * zone;

  // Дрожь горячего воздуха над огнём — слабее и мельче.
  // Только узкая полоса над языками пламени — арка камина не должна «плыть».
  float hazeZone = smoothstep(uFlame.z - 0.035, uFlame.z - 0.005, uv.y)
    * (1.0 - smoothstep(uFlame.z + 0.01, uFlame.z + 0.04, uv.y)) * horizontal;
  vec2 haze = vec2(fbm(uv * 60.0 + vec2(0.0, uTime * 3.0)) - 0.5, 0.0) * 0.003 * hazeZone;

  vec3 moved = texture2D(uImage, uv + offset + haze).rgb;

  // Смешиваем только там, где есть свет пламени — тёмные прутья решётки остаются на месте.
  float glow = max(luminance(original), luminance(moved));
  float fireMask = smoothstep(0.16, 0.42, glow) * zone + hazeZone * 0.6;
  vec3 color = mix(original, moved, clamp(fireMask, 0.0, 1.0));

  // Дыхание яркости: ярче в сердцевине, синхронно со светом в комнате.
  float core = smoothstep(0.35, 0.85, luminance(color)) * zone;
  color *= 1.0 + uFlicker * (0.12 + core * 0.35);
  color += vec3(1.0, 0.42, 0.08) * uFlicker * 0.05 * horizontal * (1.0 - height * 0.5);

  // Мягкие края, чтобы слой незаметно растворялся в фотографии.
  vec2 edge = smoothstep(vec2(0.0), vec2(0.14), vUv) * smoothstep(vec2(0.0), vec2(0.14), 1.0 - vUv);
  float alpha = edge.x * edge.y;
  gl_FragColor = vec4(color * alpha, alpha);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
  }

  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Program link failed");
  }

  return program;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

// Мерцание живого огня: несколько несоизмеримых синусов + редкие «вспышки».
function createFlicker() {
  const phases = Array.from({ length: 4 }, () => Math.random() * Math.PI * 2);
  let burst = 0;
  let nextBurstAt = 0;

  return (time) => {
    const base =
      Math.sin(time * 1.7 + phases[0]) * 0.35 +
      Math.sin(time * 2.9 + phases[1]) * 0.25 +
      Math.sin(time * 5.3 + phases[2]) * 0.15 +
      Math.sin(time * 8.1 + phases[3]) * 0.08;

    if (time > nextBurstAt) {
      burst = 0.35 + Math.random() * 0.4;
      nextBurstAt = time + 2.5 + Math.random() * 5;
    }

    burst *= 0.96;
    return Math.max(-1, Math.min(1, base * 0.7 + burst));
  };
}

/* ------------------------------------------------------------------ */
/* Искры                                                               */
/* ------------------------------------------------------------------ */

function createEmbers(canvas) {
  const context = canvas.getContext("2d");
  const embers = [];
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let spawnAccumulator = 0;

  function resize(cssWidth, cssHeight) {
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = cssWidth;
    height = cssHeight;
    canvas.width = Math.round(cssWidth * pixelRatio);
    canvas.height = Math.round(cssHeight * pixelRatio);
  }

  function spawn(intensity) {
    embers.push({
      x: width * (0.5 + (Math.random() - 0.5) * 0.36),
      y: height * (0.86 + Math.random() * 0.06),
      vx: (Math.random() - 0.5) * 14,
      vy: -(36 + Math.random() * 70) * (0.8 + intensity * 0.4),
      life: 0,
      maxLife: 1.4 + Math.random() * 2.2,
      size: 0.7 + Math.random() * 1.5,
      seed: Math.random() * 100
    });
  }

  function step(dt, time, intensity) {
    spawnAccumulator += dt * (5 + intensity * 6);

    while (spawnAccumulator > 1) {
      spawn(intensity);
      spawnAccumulator -= 1;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";

    for (let i = embers.length - 1; i >= 0; i -= 1) {
      const ember = embers[i];
      ember.life += dt;

      if (ember.life > ember.maxLife || ember.y < -10) {
        embers.splice(i, 1);
        continue;
      }

      // Восходящий поток с завихрениями.
      ember.vx += Math.sin(time * 2.2 + ember.seed) * 22 * dt;
      ember.vy *= 0.995;
      ember.x += ember.vx * dt;
      ember.y += ember.vy * dt;

      const t = ember.life / ember.maxLife;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      const twinkle = 0.7 + Math.sin(time * 18 + ember.seed) * 0.3;
      const alpha = Math.max(0, fade * twinkle);
      const radius = ember.size * (1 - t * 0.5);

      const gradient = context.createRadialGradient(ember.x, ember.y, 0, ember.x, ember.y, radius * 4);
      gradient.addColorStop(0, `rgba(255, 236, 190, ${alpha})`);
      gradient.addColorStop(0.3, `rgba(255, 160, 60, ${alpha * 0.55})`);
      gradient.addColorStop(1, "rgba(255, 90, 20, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(ember.x, ember.y, radius * 4, 0, Math.PI * 2);
      context.fill();
    }
  }

  return { resize, step };
}

/* ------------------------------------------------------------------ */
/* Сборка                                                              */
/* ------------------------------------------------------------------ */

export async function startCinematicFire({ hero, room, scene, imageSrc, isPaused }) {
  const fireCanvas = document.createElement("canvas");
  fireCanvas.className = "hero__cine-fire";
  fireCanvas.setAttribute("aria-hidden", "true");

  const gl = fireCanvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });

  if (!gl) {
    return false;
  }

  const image = await loadImage(imageSrc);
  const program = createProgram(gl);
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);

  const uniforms = {
    crop: gl.getUniformLocation(program, "uCrop"),
    time: gl.getUniformLocation(program, "uTime"),
    flicker: gl.getUniformLocation(program, "uFlicker"),
    flame: gl.getUniformLocation(program, "uFlame"),
    grate: gl.getUniformLocation(program, "uGrate")
  };

  gl.uniform4f(uniforms.crop, FIRE_CROP.x0, FIRE_CROP.y0, FIRE_CROP.x1, FIRE_CROP.y1);
  gl.uniform4f(uniforms.flame, FLAME.cx, FLAME.halfWidth, FLAME.top, FLAME.base);
  gl.uniform1f(uniforms.grate, GRATE_Y);

  const emberCanvas = document.createElement("canvas");
  emberCanvas.className = "hero__cine-embers";
  emberCanvas.setAttribute("aria-hidden", "true");
  const embers = createEmbers(emberCanvas);

  const roomLight = document.createElement("div");
  roomLight.className = "hero__cine-light";
  roomLight.setAttribute("aria-hidden", "true");

  // Слои кладём в комнату: они двигаются вместе с ней при параллаксе.
  const overlay = room.querySelector(".hero__overlay");
  room.insertBefore(roomLight, overlay);
  room.insertBefore(fireCanvas, overlay);
  room.insertBefore(emberCanvas, overlay);

  function layout() {
    const heroWidth = hero.clientWidth;
    const heroHeight = hero.clientHeight;
    const scale = Math.max(heroWidth / IMAGE_SIZE.width, heroHeight / IMAGE_SIZE.height);
    const imageWidth = IMAGE_SIZE.width * scale;
    const imageHeight = IMAGE_SIZE.height * scale;
    const [posX = "50%", posY = "50%"] = getComputedStyle(scene).backgroundPosition.split(" ");
    const ratio = (value) => (value.endsWith("%") ? parseFloat(value) / 100 : 0.5);
    const offsetX = (heroWidth - imageWidth) * ratio(posX);
    const offsetY = (heroHeight - imageHeight) * ratio(posY);
    const toX = (fraction) => offsetX + fraction * imageWidth;
    const toY = (fraction) => offsetY + fraction * imageHeight;

    const cropLeft = toX(FIRE_CROP.x0);
    const cropTop = toY(FIRE_CROP.y0);
    const cropWidth = (FIRE_CROP.x1 - FIRE_CROP.x0) * imageWidth;
    const cropHeight = (FIRE_CROP.y1 - FIRE_CROP.y0) * imageHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    Object.assign(fireCanvas.style, {
      left: `${cropLeft}px`,
      top: `${cropTop}px`,
      width: `${cropWidth}px`,
      height: `${cropHeight}px`
    });
    fireCanvas.width = Math.round(cropWidth * pixelRatio);
    fireCanvas.height = Math.round(cropHeight * pixelRatio);
    gl.viewport(0, 0, fireCanvas.width, fireCanvas.height);

    // Искры летят выше, до каминной полки.
    const emberWidth = cropWidth * 1.4;
    const emberHeight = cropHeight * 1.7;
    Object.assign(emberCanvas.style, {
      left: `${toX(LIGHT.x) - emberWidth / 2}px`,
      top: `${toY(FLAME.base) - emberHeight}px`,
      width: `${emberWidth}px`,
      height: `${emberHeight}px`
    });
    embers.resize(emberWidth, emberHeight);

    roomLight.style.setProperty("--light-x", `${toX(LIGHT.x)}px`);
    roomLight.style.setProperty("--light-y", `${toY(LIGHT.y)}px`);
    roomLight.style.setProperty("--light-r", `${imageWidth * 0.55}px`);
  }

  layout();
  window.addEventListener("resize", layout);
  hero.classList.add("hero--cinematic-fire");

  const flicker = createFlicker();
  const startTime = performance.now();
  let lastTime = startTime;

  function frame(now) {
    window.requestAnimationFrame(frame);

    if (isPaused()) {
      lastTime = now;
      return;
    }

    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    const time = (now - startTime) / 1000;
    const value = flicker(time);

    gl.uniform1f(uniforms.time, time);
    gl.uniform1f(uniforms.flicker, value);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    embers.step(dt, time, (value + 1) / 2);
    roomLight.style.opacity = String(0.55 + value * 0.35);
  }

  window.requestAnimationFrame(frame);
  return true;
}
