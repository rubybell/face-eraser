// ─── Constants ───────────────────────────────────────────────────────────────

const ERASER_SIZE = 40;          // diameter of the nose eraser circle (video pixels)
const CONFIDENCE_THRESHOLD = 0.3; // minimum keypoint confidence to use a pose
const VID_W = 640;               // webcam capture width
const VID_H = 480;               // webcam capture height

// ─── State ────────────────────────────────────────────────────────────────────

let video;        // p5 video capture element
let bodyPose;     // ml5 bodyPose instance
let poses = [];   // latest array of detected poses (up to 2)
let modelReady = false;
let gfx;          // offscreen graphics buffer — holds the gray mask with erased holes
let started = false; // whether the user has clicked Start

// ─── Audio ────────────────────────────────────────────────────────────────────

let audioCtx;
// One squeaky oscillator per tracked person (up to 2)
let squeakers = [];

// Creates the Web Audio context and two oscillators.
// Must be called from a user gesture (mousePressed) to satisfy browser autoplay policy.
function initAudio() {
  audioCtx = new AudioContext();
  for (let i = 0; i < 2; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 900 + i * 120; // slightly detune the two voices
    gain.gain.value = 0;                  // start silent
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    squeakers.push({ osc, gain, prevX: null, prevY: null });
  }
}

// ─── p5 lifecycle ─────────────────────────────────────────────────────────────

function setup() {
  createCanvas(windowWidth, windowHeight);

  // Capture webcam at native resolution; keep the element hidden
  video = createCapture(VIDEO);
  video.size(VID_W, VID_H);
  video.hide();

  // Offscreen buffer matches video resolution.
  // Starts filled solid gray; holes are punched into it as noses move.
  gfx = createGraphics(VID_W, VID_H);
  gfx.background(0);

  // Init MoveNet with mirror mode and support for up to 2 people.
  // detectStart is called inside the callback so detection only begins once
  // the model has fully loaded.
  bodyPose = ml5.bodyPose('MoveNet', { maxPoses: 2, flipped: true }, () => {
    modelReady = true;
    bodyPose.detectStart(video, gotPoses);
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// ─── Input ────────────────────────────────────────────────────────────────────

function _hitTestStart(x, y) {
  if (!started && modelReady) {
    const bw = 200, bh = 54;
    const bx = width / 2 - bw / 2;
    const by = height / 2 + 26;
    if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
      initAudio(); // AudioContext must be created inside a user gesture
      started = true;
    }
  }
}

function mousePressed() {
  _hitTestStart(mouseX, mouseY);
}

function touchStarted() {
  if (touches.length > 0) _hitTestStart(touches[0].x, touches[0].y);
  return false; // prevent scroll/zoom on mobile
}

// ─── Draw ─────────────────────────────────────────────────────────────────────

function draw() {
  if (!started) {
    drawSplash();
    return;
  }

  // Cover-fit: scale video to fill canvas, crop the overflow
  const coverScale = Math.max(width / VID_W, height / VID_H);
  const scaledW = VID_W * coverScale;
  const scaledH = VID_H * coverScale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = (height - scaledH) / 2;

  background(0); // clear letterbox/pillarbox areas

  // 1. Draw the mirrored webcam feed scaled to fill the canvas
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, offsetX, offsetY, scaledW, scaledH);
  pop();

  if (!modelReady) {
    image(gfx, offsetX, offsetY, scaledW, scaledH);
    fill(255);
    noStroke();
    textSize(18);
    textAlign(CENTER, CENTER);
    text('Loading model...', width / 2, height / 2);
    return;
  }

  // 2. For each tracked person, punch a permanent hole in the gray buffer
  //    at the nose position using destination-out compositing.
  gfx.drawingContext.globalCompositeOperation = 'destination-out';
  gfx.noStroke();
  gfx.fill(255); // colour is irrelevant; only alpha matters for destination-out

  for (let i = 0; i < 2; i++) {
    const pose = poses[i];
    const sq = squeakers[i];

    if (pose) {
      const nose = getNose(pose);
      if (nose && nose.confidence > CONFIDENCE_THRESHOLD) {

        // Erase a circle from the gray mask at the nose position
        gfx.circle(nose.x, nose.y, ERASER_SIZE);

        // Update the squeak oscillator for this person
        if (audioCtx && sq) {
          const now = audioCtx.currentTime;

          // Calculate movement speed in video-space pixels per frame
          let speed = 0;
          if (sq.prevX !== null) {
            const dx = nose.x - sq.prevX;
            const dy = nose.y - sq.prevY;
            speed = Math.sqrt(dx * dx + dy * dy);
          }
          sq.prevX = nose.x;
          sq.prevY = nose.y;

          // Volume: silent below minSpeed, ramps up with faster movement
          const minSpeed = 3;
          const activeSpeed = speed > minSpeed ? speed - minSpeed : 0;
          const vol = constrain(activeSpeed / 10, 0, 0.5);

          // Pitch: higher at the top of the frame, lower at the bottom
          const yFactor = 1 - (nose.y / VID_H);
          const freq = map(yFactor, 0, 1, 400, 1600) + activeSpeed * 25;

          sq.gain.gain.setTargetAtTime(vol, now, 0.04);
          sq.osc.frequency.setTargetAtTime(freq, now, 0.04);
        }
        continue;
      }
    }

    // No valid pose for this slot — silence its oscillator
    if (audioCtx && sq) {
      sq.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
      sq.prevX = null;
      sq.prevY = null;
    }
  }

  // 3. Restore normal compositing and draw the mask (with holes) over the video
  gfx.drawingContext.globalCompositeOperation = 'source-over';
  image(gfx, offsetX, offsetY, scaledW, scaledH);
}

// ─── Splash screen ────────────────────────────────────────────────────────────

function drawSplash() {
  background(20);

  // Horizontal scanlines for a retro CRT feel
  noStroke();
  for (let y = 0; y < height; y += 4) {
    fill(0, 0, 0, 40);
    rect(0, y, width, 2);
  }

  const cx = width / 2;
  const cy = height / 2;
  const flicker = sin(frameCount * 0.3) * 3; // subtle title flicker

  // Group all splash content around the vertical centre
  const titleY  = cy - 54;
  const buttonY = cy + 26;
  const statusY = cy + 102;

  // Title drop shadow
  noStroke();
  fill(255, 60, 0);
  textAlign(CENTER, CENTER);
  textSize(64);
  textStyle(BOLD);
  text('FACE ERASER', cx + 4 + flicker, titleY + 4);

  // Title
  fill(255, 220, 0);
  text('FACE ERASER', cx + flicker, titleY);

  const bw = 200, bh = 54;
  const bx = cx - bw / 2;
  const by = buttonY;

  if (modelReady) {
    // Pulsing active button
    const pulse = sin(frameCount * 0.08) * 0.15 + 0.85;

    // Button glow halo
    fill(255, 220, 0, 40 * pulse);
    rect(bx - 6, by - 6, bw + 12, bh + 12, 10);

    // Button body
    fill(lerpColor(color(180, 140, 0), color(255, 220, 0), pulse));
    rect(bx, by, bw, bh, 6);

    // Button label
    fill(20);
  } else {
    // Greyed-out inactive button
    fill(60, 60, 60);
    rect(bx, by, bw, bh, 6);

    // Button label
    fill(120);

    // 'loading...' status text — styled to match title
    const dots = '.'.repeat(floor(frameCount / 20) % 3 + 1);
    const loadingText = 'loading' + dots;
    fill(255, 220, 0);
    textSize(16);
    textStyle(BOLD);
    text(loadingText, cx, statusY);
    fill(120); // for the button label below
  }

  textSize(22);
  textStyle(BOLD);
  text('START', cx, by + bh / 2 + 1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Returns keypoint 0 (nose) from a MoveNet pose object.
function getNose(pose) {
  if (pose.keypoints && pose.keypoints.length > 0) {
    return pose.keypoints[0];
  }
  return null;
}

// ml5 callback — called continuously with the latest pose detections.
function gotPoses(results) {
  poses = results;
}
