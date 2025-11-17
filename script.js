// =========================
// Rainbow ink splash background (softer version)
// =========================

const bgCanvas = document.getElementById("bgCanvas");
let bgCtx = null;

if (bgCanvas) {
  bgCtx = bgCanvas.getContext("2d");

  function resizeCanvas() {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Mouse position
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let targetX = mouseX;
  let targetY = mouseY;

  window.addEventListener("mousemove", (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
  });

  // Ink particle system
  const particles = [];
  const maxParticles = 58; // slightly less than before

  class InkParticle {
    constructor(x, y) {
      this.x = x;
      this.y = y;

      // lower velocity -> calmer motion
      this.vx = (Math.random() - 0.5) * 1.2;
      this.vy = (Math.random() - 0.5) * 1.2;

      // smaller size so it does not dominate the screen
      this.size = Math.random() * 30 + 25; // 25–55
      this.maxSize = this.size;

      // overall alpha is lower so center won't blow out
      this.alpha = 0.12;

      this.hue = Math.random() * 360;
      this.life = 1;
      this.decay = 0.0025 + Math.random() * 0.0025;
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;

      // friction
      this.vx *= 0.985;
      this.vy *= 0.985;

      // gentle expansion
      this.size += 0.3;

      this.life -= this.decay;
      this.alpha = this.life * 0.18;
    }

    draw(ctx) {
      if (this.life <= 0) return;

      const gradient = ctx.createRadialGradient(
        this.x,
        this.y,
        0,
        this.x,
        this.y,
        this.size
      );

      // darker colors, no near-white center
      gradient.addColorStop(
        0,
        `hsla(${this.hue}, 45%, 26%, ${this.alpha})`
      );
      gradient.addColorStop(
        0.35,
        `hsla(${(this.hue + 35) % 360}, 55%, 32%, ${this.alpha * 0.7})`
      );
      gradient.addColorStop(
        0.75,
        `hsla(${(this.hue + 70) % 360}, 50%, 28%, ${this.alpha * 0.45})`
      );
      gradient.addColorStop(
        1,
        `hsla(${(this.hue + 100) % 360}, 45%, 24%, 0)`
      );

      ctx.save();
      // 'screen' is softer than 'lighter'
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = gradient;

      ctx.beginPath();
      const points = 8;
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const randomSize = this.size * (0.7 + Math.random() * 0.5);
        const px = this.x + Math.cos(angle) * randomSize;
        const py = this.y + Math.sin(angle) * randomSize;
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    isDead() {
      return this.life <= 0;
    }
  }

  let particleTimer = 0;

  function drawRainbowBackground() {
    const w = bgCanvas.width;
    const h = bgCanvas.height;

    // dark base + slight trail
    bgCtx.fillStyle = "rgba(5, 8, 22, 0.12)";
    bgCtx.fillRect(0, 0, w, h);

    // smooth mouse follow
    mouseX += (targetX - mouseX) * 0.08;
    mouseY += (targetY - mouseY) * 0.08;

    // create new particles near mouse
    particleTimer++;
    if (particleTimer > 1 && particles.length < maxParticles) {
      const offsetX = (Math.random() - 0.5) * 25;
      const offsetY = (Math.random() - 0.5) * 25;
      particles.push(new InkParticle(mouseX + offsetX, mouseY + offsetY));
      particleTimer = 0;
    }

    // update and draw particles
    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].update();
      particles[i].draw(bgCtx);

      if (particles[i].isDead()) {
        particles.splice(i, 1);
      }
    }

    requestAnimationFrame(drawRainbowBackground);
  }

  drawRainbowBackground();
}

// =========================
// Contact modal for index.html
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

// expose to window for HTML onclick
window.openContactModal = openContactModal;
window.closeContactModal = closeContactModal;

// =========================
// Project page modal helpers
// =========================

function showProjectModal(projectId) {
  const modal = document.getElementById(`${projectId}-modal`);
  if (modal) {
    modal.style.display = "block";
  }
}

function closeProjectModal(projectId) {
  const modal = document.getElementById(`${projectId}-modal`);
  if (modal) {
    modal.style.display = "none";
  }

  const video = document.querySelector("#video-container video");
  if (video) {
    video.pause();
  }
}

function showVideo() {
  const videoContainer = document.getElementById("video-container");
  if (videoContainer) {
    videoContainer.style.display = "block";
  }
}

// close .modal when clicking outside
window.addEventListener("click", function (event) {
  const modals = document.getElementsByClassName("modal");
  for (let modal of modals) {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  }
});

// expose helpers
window.showProjectModal = showProjectModal;
window.closeProjectModal = closeProjectModal;
window.showVideo = showVideo;
