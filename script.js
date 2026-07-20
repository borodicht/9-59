"use strict";

const atmosphereButton = document.querySelector(".hero__atmosphere-button");
const heroElement = document.querySelector(".hero");
const timerElement = document.querySelector(".hero__timer");
const dogHeadElement = document.querySelector(".hero__dog-head");

const TIMER_DURATION_MS = (9 * 60 + 59) * 1000;
const TIMER_TICK_MS = 250;
const MUSIC_FADE_DURATION_MS = 800;
const DOG_HEAD_RISE_MS = 2600;
const DOG_HEAD_HOLD_MS = 1400;
const DOG_HEAD_LOWER_MS = 3000;
const DOG_HEAD_ROTATION_DEG = -3.8;
const DOG_HEAD_LIFT_Y_PX = -6;

const AUDIO_PATHS = {
  fireplace: "./assets/audio/ambient/fireplace.mp3",
  clock: "./assets/audio/ambient/clock.mp3",
  dogHowl: "./assets/audio/ambient/dog-howl.mp3",
  bookTrack: "./assets/audio/music/book-track.mp3"
};

const AUDIO_VOLUME = {
  fireplace: 0.23,
  clock: 0.04,
  dogHowl: 0.12,
  bookTrack: 0.45
};

const audioState = {
  initialized: false,
  ambientStarted: false,
  isHowlPlaying: false,
  interactionHandlersBound: false,
  fadeFrameId: null,
  firstUserInteractionHandler: null,
  ambience: {},
  effects: {},
  music: null,
  availability: {
    fireplace: "unknown",
    clock: "unknown",
    dogHowl: "unknown",
    bookTrack: "unknown"
  }
};

let countdownEndTime = Date.now() + TIMER_DURATION_MS;
let timerIntervalId = null;
let isDogHeadAnimationRunning = false;

const howledMinutes = new Set();

if (atmosphereButton) {
  atmosphereButton.addEventListener("click", () => {
    void toggleBookTrack();
  });
}

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getRemainingSeconds(endTime) {
  const remainingMs = Math.max(0, endTime - Date.now());

  return Math.ceil(remainingMs / 1000);
}

function createAudioElement(src, volume, options = {}) {
  const audio = new Audio();

  audio.preload = options.preload ?? "auto";
  audio.loop = Boolean(options.loop);
  audio.volume = volume;
  audio.src = src;
  audio.crossOrigin = "anonymous";

  return audio;
}

function attachAvailabilityTracking(audio, key) {
  if (!audio) {
    return;
  }

  audio.addEventListener("canplaythrough", () => {
    audioState.availability[key] = "ready";
  });

  audio.addEventListener("loadeddata", () => {
    if (audioState.availability[key] !== "missing") {
      audioState.availability[key] = "ready";
    }
  });

  audio.addEventListener("error", () => {
    audioState.availability[key] = "missing";
  });
}

function bindAutoplayRetryHandlers() {
  if (audioState.interactionHandlersBound) {
    return;
  }

  const retryHandler = () => {
    void tryStartAmbientAudio();
  };

  audioState.firstUserInteractionHandler = retryHandler;
  audioState.interactionHandlersBound = true;

  ["pointerdown", "click", "touchstart", "keydown"].forEach((eventName) => {
    document.addEventListener(eventName, retryHandler, { passive: true });
  });
}

function removeAutoplayRetryHandlers() {
  if (!audioState.interactionHandlersBound || !audioState.firstUserInteractionHandler) {
    return;
  }

  ["pointerdown", "click", "touchstart", "keydown"].forEach((eventName) => {
    document.removeEventListener(eventName, audioState.firstUserInteractionHandler, { passive: true });
  });

  audioState.firstUserInteractionHandler = null;
  audioState.interactionHandlersBound = false;
}

function updateTrackButton(isPlaying) {
  if (!atmosphereButton) {
    return;
  }

  atmosphereButton.textContent = isPlaying ? "Выключить трек" : "Включить трек";
  atmosphereButton.setAttribute("aria-pressed", String(isPlaying));
}

function resetHowledMinutes() {
  howledMinutes.clear();
}

function initializeFireAnimation() {
  if (!heroElement || heroElement.dataset.fireAnimationInitialized === "true") {
    return;
  }

  heroElement.dataset.fireAnimationInitialized = "true";
  heroElement.classList.add("hero--fire-active");
}

async function initializeAudio() {
  if (audioState.initialized) {
    return audioState;
  }

  audioState.ambience.fireplace = createAudioElement(
    AUDIO_PATHS.fireplace,
    AUDIO_VOLUME.fireplace,
    { loop: true }
  );
  audioState.ambience.clock = createAudioElement(
    AUDIO_PATHS.clock,
    AUDIO_VOLUME.clock,
    { loop: true }
  );
  audioState.effects.dogHowl = createAudioElement(
    AUDIO_PATHS.dogHowl,
    AUDIO_VOLUME.dogHowl
  );
  audioState.music = createAudioElement(
    AUDIO_PATHS.bookTrack,
    0,
    { loop: false }
  );

  attachAvailabilityTracking(audioState.ambience.fireplace, "fireplace");
  attachAvailabilityTracking(audioState.ambience.clock, "clock");
  attachAvailabilityTracking(audioState.effects.dogHowl, "dogHowl");
  attachAvailabilityTracking(audioState.music, "bookTrack");

  audioState.ambience.fireplace.load();
  audioState.ambience.clock.load();
  audioState.effects.dogHowl.load();
  audioState.music.load();

  bindAutoplayRetryHandlers();
  updateTrackButton(false);
  audioState.initialized = true;

  return audioState;
}

function getPlayableAmbientAudio() {
  const pairs = [
    ["fireplace", audioState.ambience.fireplace],
    ["clock", audioState.ambience.clock]
  ];

  return pairs
    .filter(([key, audio]) => audio && audioState.availability[key] !== "missing")
    .map(([, audio]) => audio);
}

async function startAmbientAudio() {
  const playableAudio = getPlayableAmbientAudio();

  if (playableAudio.length === 0) {
    audioState.ambientStarted = true;
    removeAutoplayRetryHandlers();
    return true;
  }

  const playResults = await Promise.allSettled(
    playableAudio.map((audio) => {
      if (!audio.paused) {
        return Promise.resolve();
      }

      return audio.play();
    })
  );

  const allStarted = playResults.every((result) => result.status === "fulfilled");

  if (allStarted) {
    audioState.ambientStarted = true;
    removeAutoplayRetryHandlers();
  }

  return allStarted;
}

async function tryStartAmbientAudio() {
  await initializeAudio();

  if (audioState.ambientStarted) {
    return true;
  }

  try {
    return await startAmbientAudio();
  } catch {
    return false;
  }
}

function stopAmbientAudio() {
  [audioState.ambience.fireplace, audioState.ambience.clock].forEach((audio) => {
    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
  });

  if (audioState.effects.dogHowl) {
    audioState.effects.dogHowl.pause();
    audioState.effects.dogHowl.currentTime = 0;
  }

  audioState.isHowlPlaying = false;
  audioState.ambientStarted = false;
}

function fadeAudio(audio, targetVolume, durationMs) {
  if (!audio) {
    return Promise.resolve();
  }

  if (audioState.fadeFrameId !== null) {
    window.cancelAnimationFrame(audioState.fadeFrameId);
    audioState.fadeFrameId = null;
  }

  const startVolume = audio.volume;
  const startTime = performance.now();

  return new Promise((resolve) => {
    function step(now) {
      const progress = Math.min(1, (now - startTime) / durationMs);
      audio.volume = startVolume + (targetVolume - startVolume) * progress;

      if (progress < 1) {
        audioState.fadeFrameId = window.requestAnimationFrame(step);
        return;
      }

      audioState.fadeFrameId = null;
      resolve();
    }

    audioState.fadeFrameId = window.requestAnimationFrame(step);
  });
}

async function toggleBookTrack() {
  await initializeAudio();

  if (!audioState.music || audioState.availability.bookTrack === "missing") {
    return;
  }

  if (audioState.music.paused) {
    await tryStartAmbientAudio();
    audioState.music.volume = 0;

    try {
      await audioState.music.play();
    } catch {
      updateTrackButton(false);
      return;
    }

    updateTrackButton(true);
    await fadeAudio(audioState.music, AUDIO_VOLUME.bookTrack, MUSIC_FADE_DURATION_MS);
    return;
  }

  await fadeAudio(audioState.music, 0, MUSIC_FADE_DURATION_MS);
  audioState.music.pause();
  updateTrackButton(false);
}

function playDogHeadAnimation() {
  if (!dogHeadElement || isDogHeadAnimationRunning) {
    return Promise.resolve();
  }

  isDogHeadAnimationRunning = true;

  const animation = dogHeadElement.animate(
    [
      { opacity: 0, transform: "rotate(0deg) translate3d(0, 0, 0)" },
      {
        opacity: 0.96,
        transform: `rotate(${DOG_HEAD_ROTATION_DEG}deg) translate3d(0, ${DOG_HEAD_LIFT_Y_PX}px, 0)`,
        offset: DOG_HEAD_RISE_MS / (DOG_HEAD_RISE_MS + DOG_HEAD_HOLD_MS + DOG_HEAD_LOWER_MS)
      },
      {
        opacity: 0.96,
        transform: `rotate(${DOG_HEAD_ROTATION_DEG}deg) translate3d(0, ${DOG_HEAD_LIFT_Y_PX}px, 0)`,
        offset: (DOG_HEAD_RISE_MS + DOG_HEAD_HOLD_MS) / (DOG_HEAD_RISE_MS + DOG_HEAD_HOLD_MS + DOG_HEAD_LOWER_MS)
      },
      { opacity: 0, transform: "rotate(0deg) translate3d(0, 0, 0)" }
    ],
    {
      duration: DOG_HEAD_RISE_MS + DOG_HEAD_HOLD_MS + DOG_HEAD_LOWER_MS,
      easing: "ease-in-out",
      fill: "none"
    }
  );

  return animation.finished
    .catch(() => undefined)
    .finally(() => {
      isDogHeadAnimationRunning = false;
      dogHeadElement.style.opacity = "";
      dogHeadElement.style.transform = "";
    });
}

async function playDogHowl() {
  const howlAudio = audioState.effects.dogHowl;

  if (
    !audioState.ambientStarted ||
    document.hidden ||
    audioState.isHowlPlaying ||
    !howlAudio ||
    audioState.availability.dogHowl === "missing" ||
    !howlAudio.paused
  ) {
    return false;
  }

  void playDogHeadAnimation();

  try {
    audioState.isHowlPlaying = true;
    howlAudio.currentTime = 0;
    await howlAudio.play();
    howlAudio.onended = () => {
      audioState.isHowlPlaying = false;
      howlAudio.onended = null;
    };
    return true;
  } catch {
    audioState.isHowlPlaying = false;
    return false;
  }
}

function checkMinuteHowl(minutes, seconds, options = {}) {
  const { allowHowl = true } = options;

  if (!allowHowl || document.hidden || seconds !== 0 || minutes < 1 || minutes > 9) {
    return;
  }

  if (howledMinutes.has(minutes)) {
    return;
  }

  howledMinutes.add(minutes);
  void playDogHowl();
}

function updateTimer(options = {}) {
  const { allowHowl = true } = options;

  if (!timerElement) {
    return;
  }

  const remainingSeconds = getRemainingSeconds(countdownEndTime);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  timerElement.textContent = formatTime(remainingSeconds);
  checkMinuteHowl(minutes, seconds, { allowHowl });

  if (remainingSeconds === 0 && timerIntervalId !== null) {
    window.clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

function startCountdown() {
  if (!timerElement) {
    return;
  }

  countdownEndTime = Date.now() + TIMER_DURATION_MS;
  resetHowledMinutes();
  timerElement.textContent = "09:59";
  updateTimer({ allowHowl: false });
  timerIntervalId = window.setInterval(() => {
    updateTimer({ allowHowl: true });
  }, TIMER_TICK_MS);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (audioState.effects.dogHowl && !audioState.effects.dogHowl.paused) {
      audioState.effects.dogHowl.pause();
      audioState.effects.dogHowl.currentTime = 0;
    }

    audioState.isHowlPlaying = false;

    return;
  }

  updateTimer({ allowHowl: false });

  if (!audioState.ambientStarted) {
    void tryStartAmbientAudio();
  }
});

initializeFireAnimation();
void initializeAudio().then(() => {
  void tryStartAmbientAudio();
});
startCountdown();
