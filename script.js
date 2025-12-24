// =========================
// WebGL Fluid Simulation
// Based on PavelDoGreat's WebGL Fluid Simulation
// =========================

'use strict';

// Wait for DOM to be fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFluidSimulation);
} else {
    initFluidSimulation();
}

function initFluidSimulation() {
    const canvas = document.getElementById("bgCanvas");
    
    if (!canvas) {
        console.error('Canvas element #bgCanvas not found!');
        return;
    }

    // CRITICAL: Set canvas size to window size
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    console.log(`Fluid simulation initializing. Canvas: ${canvas.width}x${canvas.height}`);

    let config = {
        SIM_RESOLUTION: 128,
        DYE_RESOLUTION: 512,
        DENSITY_DISSIPATION: 0.97,
        VELOCITY_DISSIPATION: 0.98,
        PRESSURE_DISSIPATION: 0.8,
        PRESSURE_ITERATIONS: 20,
        CURL: 30,
        SPLAT_RADIUS: 0.35,
        SPLAT_FORCE: 6000,
        BACK_COLOR: { r: 5, g: 8, b: 22 },
        AUTO_SPLAT_INTERVAL: 300,  // More frequent: every 300ms
        INITIAL_SPLATS: 15,        // More initial splats
    };

    let pointers = [];
    let autoSplatTimer = 0;

    // Get WebGL context
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    let gl = canvas.getContext('webgl2', params);
    const isWebGL2 = !!gl;
    
    if (!gl) {
        gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
    }

    if (!gl) {
        console.error('WebGL not supported');
        return;
    }

    // Extensions
    let halfFloat;
    let supportLinearFiltering;
    
    if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
    } else {
        halfFloat = gl.getExtension('OES_texture_half_float');
        supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;

    // Format support
    function getSupportedFormat(gl, internalFormat, format, type) {
        if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
            switch (internalFormat) {
                case gl.R16F: return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
                case gl.RG16F: return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
                default: return null;
            }
        }
        return { internalFormat, format };
    }

    function supportRenderTextureFormat(gl, internalFormat, format, type) {
        let texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

        let fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        gl.deleteTexture(texture);
        gl.deleteFramebuffer(fbo);
        return status === gl.FRAMEBUFFER_COMPLETE;
    }

    let formatRGBA, formatRG, formatR;
    
    if (isWebGL2) {
        formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    } else {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    }

    if (!formatRGBA || !formatRG || !formatR) {
        console.error('Required texture formats not supported');
        return;
    }

    // Pointer class
    function pointerPrototype() {
        this.id = -1;
        this.texcoordX = 0;
        this.texcoordY = 0;
        this.prevTexcoordX = 0;
        this.prevTexcoordY = 0;
        this.deltaX = 0;
        this.deltaY = 0;
        this.down = false;
        this.moved = false;
        this.color = { r: 0.5, g: 0.2, b: 0.8 };
    }

    pointers.push(new pointerPrototype());

    // Shader compilation
    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader error:', gl.getShaderInfoLog(shader));
            throw gl.getShaderInfoLog(shader);
        }
        return shader;
    }

    class GLProgram {
        constructor(vertexShader, fragmentShader) {
            this.uniforms = {};
            this.program = gl.createProgram();
            gl.attachShader(this.program, vertexShader);
            gl.attachShader(this.program, fragmentShader);
            gl.linkProgram(this.program);

            if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
                console.error('Program error:', gl.getProgramInfoLog(this.program));
                throw gl.getProgramInfoLog(this.program);
            }

            const uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
            for (let i = 0; i < uniformCount; i++) {
                const uniformName = gl.getActiveUniform(this.program, i).name;
                this.uniforms[uniformName] = gl.getUniformLocation(this.program, uniformName);
            }
        }
        bind() { gl.useProgram(this.program); }
    }

    // Shaders
    const baseVertexShader = compileShader(gl.VERTEX_SHADER, `
        precision highp float;
        attribute vec2 aPosition;
        varying vec2 vUv;
        varying vec2 vL, vR, vT, vB;
        uniform vec2 texelSize;
        void main () {
            vUv = aPosition * 0.5 + 0.5;
            vL = vUv - vec2(texelSize.x, 0.0);
            vR = vUv + vec2(texelSize.x, 0.0);
            vT = vUv + vec2(0.0, texelSize.y);
            vB = vUv - vec2(0.0, texelSize.y);
            gl_Position = vec4(aPosition, 0.0, 1.0);
        }
    `);

    const clearShader = compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying vec2 vUv;
        uniform sampler2D uTexture;
        uniform float value;
        void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
    `);

    const colorShader = compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        uniform vec4 color;
        void main () { gl_FragColor = color; }
    `);

    const displayShader = compileShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uTexture;
        void main () {
            vec3 c = texture2D(uTexture, vUv).rgb;
            gl_FragColor = vec4(c, 1.0);
        }
    `);

    const splatShader = compileShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uTarget;
        uniform float aspectRatio;
        uniform vec3 color;
        uniform vec2 point;
        uniform float radius;
        void main () {
            vec2 p = vUv - point.xy;
            p.x *= aspectRatio;
            vec3 splat = exp(-dot(p, p) / radius) * color;
            vec3 base = texture2D(uTarget, vUv).xyz;
            gl_FragColor = vec4(base + splat, 1.0);
        }
    `);

    const advectionShader = compileShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uVelocity;
        uniform sampler2D uSource;
        uniform vec2 texelSize;
        uniform float dt;
        uniform float dissipation;
        void main () {
            vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
            gl_FragColor = dissipation * texture2D(uSource, coord);
            gl_FragColor.a = 1.0;
        }
    `);

    const divergenceShader = compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying vec2 vUv, vL, vR, vT, vB;
        uniform sampler2D uVelocity;
        void main () {
            float L = texture2D(uVelocity, vL).x;
            float R = texture2D(uVelocity, vR).x;
            float T = texture2D(uVelocity, vT).y;
            float B = texture2D(uVelocity, vB).y;
            vec2 C = texture2D(uVelocity, vUv).xy;
            if (vL.x < 0.0) L = -C.x;
            if (vR.x > 1.0) R = -C.x;
            if (vT.y > 1.0) T = -C.y;
            if (vB.y < 0.0) B = -C.y;
            float div = 0.5 * (R - L + T - B);
            gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
        }
    `);

    const curlShader = compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying vec2 vUv, vL, vR, vT, vB;
        uniform sampler2D uVelocity;
        void main () {
            float L = texture2D(uVelocity, vL).y;
            float R = texture2D(uVelocity, vR).y;
            float T = texture2D(uVelocity, vT).x;
            float B = texture2D(uVelocity, vB).x;
            float vorticity = R - L - T + B;
            gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
        }
    `);

    const vorticityShader = compileShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        varying vec2 vUv, vL, vR, vT, vB;
        uniform sampler2D uVelocity;
        uniform sampler2D uCurl;
        uniform float curl;
        uniform float dt;
        void main () {
            float L = texture2D(uCurl, vL).x;
            float R = texture2D(uCurl, vR).x;
            float T = texture2D(uCurl, vT).x;
            float B = texture2D(uCurl, vB).x;
            float C = texture2D(uCurl, vUv).x;
            vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
            force /= length(force) + 0.0001;
            force *= curl * C;
            force.y *= -1.0;
            vec2 vel = texture2D(uVelocity, vUv).xy;
            gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
        }
    `);

    const pressureShader = compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying vec2 vUv, vL, vR, vT, vB;
        uniform sampler2D uPressure;
        uniform sampler2D uDivergence;
        void main () {
            float L = texture2D(uPressure, vL).x;
            float R = texture2D(uPressure, vR).x;
            float T = texture2D(uPressure, vT).x;
            float B = texture2D(uPressure, vB).x;
            float divergence = texture2D(uDivergence, vUv).x;
            float pressure = (L + R + B + T - divergence) * 0.25;
            gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
        }
    `);

    const gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying vec2 vUv, vL, vR, vT, vB;
        uniform sampler2D uPressure;
        uniform sampler2D uVelocity;
        void main () {
            float L = texture2D(uPressure, vL).x;
            float R = texture2D(uPressure, vR).x;
            float T = texture2D(uPressure, vT).x;
            float B = texture2D(uPressure, vB).x;
            vec2 velocity = texture2D(uVelocity, vUv).xy;
            velocity.xy -= vec2(R - L, T - B);
            gl_FragColor = vec4(velocity, 0.0, 1.0);
        }
    `);

    // Blit setup
    const blit = (() => {
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
        return (dest) => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, dest);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        };
    })();

    // Programs
    const clearProgram = new GLProgram(baseVertexShader, clearShader);
    const colorProgram = new GLProgram(baseVertexShader, colorShader);
    const displayProgram = new GLProgram(baseVertexShader, displayShader);
    const splatProgram = new GLProgram(baseVertexShader, splatShader);
    const advectionProgram = new GLProgram(baseVertexShader, advectionShader);
    const divergenceProgram = new GLProgram(baseVertexShader, divergenceShader);
    const curlProgram = new GLProgram(baseVertexShader, curlShader);
    const vorticityProgram = new GLProgram(baseVertexShader, vorticityShader);
    const pressureProgram = new GLProgram(baseVertexShader, pressureShader);
    const gradientSubtractProgram = new GLProgram(baseVertexShader, gradientSubtractShader);

    // FBO functions
    function createFBO(w, h, internalFormat, format, type, param) {
        gl.activeTexture(gl.TEXTURE0);
        let texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

        let fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);

        return {
            texture, fbo, width: w, height: h,
            texelSizeX: 1.0 / w, texelSizeY: 1.0 / h,
            attach(id) {
                gl.activeTexture(gl.TEXTURE0 + id);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                return id;
            }
        };
    }

    function createDoubleFBO(w, h, internalFormat, format, type, param) {
        let fbo1 = createFBO(w, h, internalFormat, format, type, param);
        let fbo2 = createFBO(w, h, internalFormat, format, type, param);
        return {
            width: w, height: h,
            texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
            get read() { return fbo1; },
            set read(v) { fbo1 = v; },
            get write() { return fbo2; },
            set write(v) { fbo2 = v; },
            swap() { let t = fbo1; fbo1 = fbo2; fbo2 = t; }
        };
    }

    function getResolution(resolution) {
        let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
        if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
        let min = Math.round(resolution);
        let max = Math.round(resolution * aspectRatio);
        if (gl.drawingBufferWidth > gl.drawingBufferHeight)
            return { width: max, height: min };
        return { width: min, height: max };
    }

    // Initialize FBOs
    let dye, velocity, divergence, curl, pressure;

    function initFramebuffers() {
        let simRes = getResolution(config.SIM_RESOLUTION);
        let dyeRes = getResolution(config.DYE_RESOLUTION);

        const texType = halfFloatTexType;
        const filtering = supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

        dye = createDoubleFBO(dyeRes.width, dyeRes.height, formatRGBA.internalFormat, formatRGBA.format, texType, filtering);
        velocity = createDoubleFBO(simRes.width, simRes.height, formatRG.internalFormat, formatRG.format, texType, filtering);
        divergence = createFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, gl.NEAREST);
        curl = createFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, gl.NEAREST);
        pressure = createDoubleFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, gl.NEAREST);
    }

    initFramebuffers();

    // Splat function
    function splat(x, y, dx, dy, color) {
        gl.viewport(0, 0, velocity.width, velocity.height);
        splatProgram.bind();
        gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
        gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
        gl.uniform2f(splatProgram.uniforms.point, x, y);
        gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
        gl.uniform1f(splatProgram.uniforms.radius, config.SPLAT_RADIUS / 100.0);
        blit(velocity.write.fbo);
        velocity.swap();

        gl.viewport(0, 0, dye.width, dye.height);
        gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
        gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
        blit(dye.write.fbo);
        dye.swap();
    }

    // Soft color for mouse movement
    function generateColor() {
        const h = Math.random();
        const s = 0.3 + Math.random() * 0.2; // Low saturation
        const l = 0.4 + Math.random() * 0.2;
        
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        
        const intensity = 0.15 + Math.random() * 0.1;
        return { r: r * intensity, g: g * intensity, b: b * intensity };
    }

    // Brighter color for random auto splats
    function generateBrightColor() {
        const h = Math.random();
        const s = 0.6 + Math.random() * 0.3; // Higher saturation: 0.6-0.9
        const l = 0.5 + Math.random() * 0.2; // Brighter: 0.5-0.7
        
        let r, g, b;
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
        
        const intensity = 0.4 + Math.random() * 0.2; // Brighter: 0.4-0.6
        return { r: r * intensity, g: g * intensity, b: b * intensity };
    }

    function multipleSplats(amount) {
        for (let i = 0; i < amount; i++) {
            const color = generateBrightColor(); // Use bright color for random splats
            const x = Math.random();
            const y = Math.random();
            const dx = 1000 * (Math.random() - 0.5);
            const dy = 1000 * (Math.random() - 0.5);
            splat(x, y, dx, dy, color);
        }
    }

    // Initial splats for opening animation
    multipleSplats(config.INITIAL_SPLATS);

    // Simulation step
    function step(dt) {
        gl.disable(gl.BLEND);
        gl.viewport(0, 0, velocity.width, velocity.height);

        curlProgram.bind();
        gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
        blit(curl.fbo);

        vorticityProgram.bind();
        gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
        gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
        gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
        gl.uniform1f(vorticityProgram.uniforms.dt, dt);
        blit(velocity.write.fbo);
        velocity.swap();

        divergenceProgram.bind();
        gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
        blit(divergence.fbo);

        clearProgram.bind();
        gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
        gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE_DISSIPATION);
        blit(pressure.write.fbo);
        pressure.swap();

        pressureProgram.bind();
        gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
        for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
            gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
            blit(pressure.write.fbo);
            pressure.swap();
        }

        gradientSubtractProgram.bind();
        gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
        gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
        blit(velocity.write.fbo);
        velocity.swap();

        advectionProgram.bind();
        gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
        gl.uniform1i(advectionProgram.uniforms.uSource, velocity.read.attach(0));
        gl.uniform1f(advectionProgram.uniforms.dt, dt);
        gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
        blit(velocity.write.fbo);
        velocity.swap();

        gl.viewport(0, 0, dye.width, dye.height);
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
        gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
        gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
        blit(dye.write.fbo);
        dye.swap();
    }

    function render() {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        
        // Background
        colorProgram.bind();
        let bc = config.BACK_COLOR;
        gl.uniform4f(colorProgram.uniforms.color, bc.r/255, bc.g/255, bc.b/255, 1.0);
        blit(null);
        
        // Fluid
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);
        displayProgram.bind();
        gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
        blit(null);
        gl.disable(gl.BLEND);
    }

    // Main loop
    let lastTime = Date.now();

    function update() {
        const now = Date.now();
        const dt = Math.min((now - lastTime) / 1000, 0.016);
        lastTime = now;

        // Resize check
        if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            initFramebuffers();
        }

        // Apply pointer input
        pointers.forEach(p => {
            if (p.moved) {
                p.moved = false;
                splat(p.texcoordX, p.texcoordY, p.deltaX * config.SPLAT_FORCE, p.deltaY * config.SPLAT_FORCE, p.color);
            }
        });

        // Auto splat for continuous animation
        autoSplatTimer += dt * 1000;
        if (autoSplatTimer > config.AUTO_SPLAT_INTERVAL) {
            autoSplatTimer = 0;
            const color = generateBrightColor(); // Use bright color for auto splats
            splat(Math.random(), Math.random(), 1000 * (Math.random() - 0.5), 1000 * (Math.random() - 0.5), color);
        }

        step(dt);
        render();

        requestAnimationFrame(update);
    }

    // Mouse events on window (not canvas, since canvas has pointer-events: none)
    window.addEventListener('mousemove', (e) => {
        let p = pointers[0];
        p.prevTexcoordX = p.texcoordX;
        p.prevTexcoordY = p.texcoordY;
        p.texcoordX = e.clientX / window.innerWidth;
        p.texcoordY = 1.0 - e.clientY / window.innerHeight;
        p.deltaX = p.texcoordX - p.prevTexcoordX;
        p.deltaY = p.texcoordY - p.prevTexcoordY;
        p.moved = Math.abs(p.deltaX) > 0 || Math.abs(p.deltaY) > 0;
        p.color = generateColor();
    });

    // Touch events
    window.addEventListener('touchstart', (e) => {
        const touches = e.targetTouches;
        while (touches.length >= pointers.length)
            pointers.push(new pointerPrototype());
        for (let i = 0; i < touches.length; i++) {
            let p = pointers[i];
            p.id = touches[i].identifier;
            p.down = true;
            p.texcoordX = touches[i].pageX / window.innerWidth;
            p.texcoordY = 1.0 - touches[i].pageY / window.innerHeight;
            p.prevTexcoordX = p.texcoordX;
            p.prevTexcoordY = p.texcoordY;
            p.color = generateColor();
        }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        const touches = e.targetTouches;
        for (let i = 0; i < touches.length; i++) {
            let p = pointers[i];
            if (!p || !p.down) continue;
            p.prevTexcoordX = p.texcoordX;
            p.prevTexcoordY = p.texcoordY;
            p.texcoordX = touches[i].pageX / window.innerWidth;
            p.texcoordY = 1.0 - touches[i].pageY / window.innerHeight;
            p.deltaX = p.texcoordX - p.prevTexcoordX;
            p.deltaY = p.texcoordY - p.prevTexcoordY;
            p.moved = Math.abs(p.deltaX) > 0 || Math.abs(p.deltaY) > 0;
        }
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
        const touches = e.changedTouches;
        for (let i = 0; i < touches.length; i++) {
            let p = pointers.find(p => p.id === touches[i].identifier);
            if (p) p.down = false;
        }
    });

    // Window resize
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        initFramebuffers();
    });

    console.log('Fluid simulation started successfully');
    update();
}

// =========================
// UI Helpers (Modals etc.)
// =========================

function openContactModal() {
    const modal = document.getElementById("contact-modal");
    const overlay = document.getElementById("modal-overlay");
    if (modal && overlay) {
        modal.style.display = "block";
        overlay.style.display = "block";
    }
}

function closeContactModal() {
    const modal = document.getElementById("contact-modal");
    const overlay = document.getElementById("modal-overlay");
    if (modal && overlay) {
        modal.style.display = "none";
        overlay.style.display = "none";
    }
}

window.openContactModal = openContactModal;
window.closeContactModal = closeContactModal;

window.addEventListener("click", function (event) {
    const overlay = document.getElementById("modal-overlay");
    if (event.target === overlay) {
        closeContactModal();
    }
});

window.showProjectModal = function (projectId) {
    const modal = document.getElementById(`${projectId}-modal`);
    if (modal) modal.style.display = "block";
};

window.closeProjectModal = function (projectId) {
    const modal = document.getElementById(`${projectId}-modal`);
    if (modal) modal.style.display = "none";
    const video = document.querySelector("#video-container video");
    if (video) video.pause();
};