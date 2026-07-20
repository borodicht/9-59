"use strict";

const atmosphereButton = document.querySelector(".hero__atmosphere-button");
const heroElement = document.querySelector(".hero");
const timerElement = document.querySelector(".hero__timer");
const dogHeadElement = document.querySelector(".hero__dog-head");
const sparkPoolElement = document.querySelector(".hero__spark-pool");
const readerTriggerElement = document.querySelector("[data-open-reader]");
const readerLayerElement = document.querySelector(".reader-layer");
const readerDialogElement = document.querySelector(".reader-dialog");
const readerPageElement = document.querySelector(".reader-dialog__page");
const readerMetaElement = document.querySelector("[data-reader-meta]");
const readerPrevButton = document.querySelector("[data-reader-prev]");
const readerNextButton = document.querySelector("[data-reader-next]");
const readerCloseElements = document.querySelectorAll("[data-close-reader]");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const TIMER_DURATION_MS = (9 * 60 + 59) * 1000;
const TIMER_TICK_MS = 250;
const MUSIC_FADE_DURATION_MS = 800;
const SPARK_POOL_SIZE = 6;
const SPARK_BURST_MIN_DELAY_MS = 8000;
const SPARK_BURST_MAX_DELAY_MS = 20000;
const SPARK_BURST_MIN_COUNT = 1;
const SPARK_BURST_MAX_COUNT = 3;
const SPARK_DURATION_MIN_MS = 1000;
const SPARK_DURATION_MAX_MS = 2500;
const DOG_HEAD_ANIMATION_CLASS = "is-howling";
const DOG_HEAD_ANIMATION_DURATION_MS = 7000;
const DOG_HEAD_ANIMATION_REDUCED_DURATION_MS = 2200;
const READER_CONTENT_PATH = "assets/content/fragment.json";
const READER_CLOSE_DURATION_MS = 320;
const READER_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

const AUDIO_PATHS = {
  fireplace: "./assets/audio/ambient/fireplace.mp3",
  clock: "./assets/audio/ambient/clock.mp3",
  dogHowl: "./assets/audio/ambient/dog-howl.mp3",
  bookTrack: "./assets/audio/music/book-track.mp3"
};

const AUDIO_VOLUME = {
  fireplace: 0.23,
  clock: 0.04,
  dogHowl: 1,
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
let sparkTimeoutId = null;
let sparkElements = [];
let isDogAnimating = false;
let isReaderOpen = false;
let readerContentPromise = null;
let readerContent = null;
let currentReaderPageIndex = 0;
let lastReaderTrigger = null;

const howledMinutes = new Set();

if (atmosphereButton) {
  atmosphereButton.addEventListener("click", () => {
    void toggleBookTrack();
  });
}

if (readerTriggerElement) {
  readerTriggerElement.addEventListener("click", (event) => {
    event.preventDefault();
    void openReader();
  });
}

readerCloseElements.forEach((element) => {
  element.addEventListener("click", () => {
    closeReader();
  });
});

if (readerPrevButton) {
  readerPrevButton.addEventListener("click", () => {
    changeReaderPage(-1);
  });
}

if (readerNextButton) {
  readerNextButton.addEventListener("click", () => {
    changeReaderPage(1);
  });
}

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function loadReaderContent() {
  if (readerContent) {
    return readerContent;
  }

  if (!readerContentPromise) {
    readerContentPromise = fetch(READER_CONTENT_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load fragment content: ${response.status}`);
        }

        return response.json();
      })
      .then((data) => {
        readerContent = data;
        return data;
      });
  }

  return readerContentPromise;
}

function renderReaderPage(index) {
  if (!readerContent || !readerPageElement || !readerMetaElement || !readerPrevButton || !readerNextButton) {
    return;
  }

  const page = readerContent.pages[index];

  if (!page) {
    return;
  }

  readerPageElement.classList.remove("is-transitioning");
  void readerPageElement.offsetWidth;
  readerPageElement.classList.add("is-transitioning");
  readerPageElement.innerHTML = page.paragraphs
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("");
  readerPageElement.scrollTop = 0;

  const totalPages = readerContent.pages.length;
  readerMetaElement.textContent = `${index + 1} / ${totalPages}`;
  readerPrevButton.hidden = index === 0;
  readerNextButton.hidden = index === totalPages - 1;
}

function trapReaderFocus(event) {
  if (!isReaderOpen || event.key !== "Tab" || !readerDialogElement) {
    return;
  }

  const focusableElements = Array.from(
    readerDialogElement.querySelectorAll(READER_FOCUSABLE_SELECTOR)
  ).filter((element) => !element.hasAttribute("hidden"));

  if (!focusableElements.length) {
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

function handleReaderKeydown(event) {
  if (!isReaderOpen) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeReader();
    return;
  }

  if (event.key === "ArrowRight" && !readerNextButton?.hidden) {
    event.preventDefault();
    changeReaderPage(1);
    return;
  }

  if (event.key === "ArrowLeft" && !readerPrevButton?.hidden) {
    event.preventDefault();
    changeReaderPage(-1);
    return;
  }

  trapReaderFocus(event);
}

async function openReader() {
  if (isReaderOpen || !readerLayerElement || !readerDialogElement) {
    return;
  }

  lastReaderTrigger = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : readerTriggerElement;

  try {
    await loadReaderContent();
  } catch {
    return;
  }

  currentReaderPageIndex = 0;
  renderReaderPage(currentReaderPageIndex);
  isReaderOpen = true;
  document.body.classList.add("reader-open");
  readerLayerElement.setAttribute("aria-hidden", "false");
  readerLayerElement.classList.remove("is-closing");
  readerLayerElement.classList.add("is-open");
  document.addEventListener("keydown", handleReaderKeydown);

  window.setTimeout(() => {
    readerDialogElement.focus();
  }, 40);
}

function closeReader() {
  if (!isReaderOpen || !readerLayerElement) {
    return;
  }

  isReaderOpen = false;
  document.removeEventListener("keydown", handleReaderKeydown);
  readerLayerElement.classList.add("is-closing");
  readerLayerElement.classList.remove("is-open");

  window.setTimeout(() => {
    readerLayerElement.setAttribute("aria-hidden", "true");
    readerLayerElement.classList.remove("is-closing");
    document.body.classList.remove("reader-open");

    if (lastReaderTrigger instanceof HTMLElement) {
      lastReaderTrigger.focus();
    }
  }, READER_CLOSE_DURATION_MS);
}

function changeReaderPage(direction) {
  if (!readerContent) {
    return;
  }

  const nextIndex = currentReaderPageIndex + direction;

  if (nextIndex < 0 || nextIndex >= readerContent.pages.length) {
    return;
  }

  currentReaderPageIndex = nextIndex;
  renderReaderPage(currentReaderPageIndex);
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

function resetDogMinuteEvents() {
  howledMinutes.clear();
}

function initializeFireAnimation() {
  if (!heroElement || heroElement.dataset.fireAnimationInitialized === "true") {
    return;
  }

  heroElement.dataset.fireAnimationInitialized = "true";
  heroElement.classList.add("hero--fire-active");
  initializeSparks();

  if (!document.hidden) {
    scheduleNextSparkBurst();
  }
}

function initializeSparks() {
  if (!sparkPoolElement || sparkPoolElement.dataset.sparkPoolInitialized === "true") {
    return;
  }

  sparkPoolElement.dataset.sparkPoolInitialized = "true";
  sparkElements = Array.from({ length: SPARK_POOL_SIZE }, () => {
    const spark = document.createElement("span");
    spark.className = "hero__spark";
    spark.setAttribute("aria-hidden", "true");
    spark.addEventListener("animationend", () => {
      spark.classList.remove("hero__spark--active");
    });
    sparkPoolElement.appendChild(spark);
    return spark;
  });
}

function scheduleNextSparkBurst() {
  if (
    heroElement?.dataset.fireAnimationInitialized !== "true" ||
    document.hidden
  ) {
    return;
  }

  cancelScheduledSparks();

  const delay =
    SPARK_BURST_MIN_DELAY_MS +
    Math.random() * (SPARK_BURST_MAX_DELAY_MS - SPARK_BURST_MIN_DELAY_MS);

  sparkTimeoutId = window.setTimeout(() => {
    playSparkBurst();
    scheduleNextSparkBurst();
  }, delay);
}

function playSparkBurst() {
  if (!sparkElements.length || document.hidden) {
    return;
  }

  const availableSparks = sparkElements.filter(
    (spark) => !spark.classList.contains("hero__spark--active")
  );

  if (!availableSparks.length) {
    return;
  }

  const sparkCount = Math.min(
    availableSparks.length,
    SPARK_BURST_MIN_COUNT +
      Math.floor(Math.random() * (SPARK_BURST_MAX_COUNT - SPARK_BURST_MIN_COUNT + 1))
  );

  availableSparks
    .sort(() => Math.random() - 0.5)
    .slice(0, sparkCount)
    .forEach((spark) => {
      const size = 0.2 + Math.random() * 0.18;
      const left = 34 + Math.random() * 32;
      const bottom = 10 + Math.random() * 18;
      const driftX = -0.4 + Math.random() * 0.8;
      const rise = -(1.1 + Math.random() * 1.4);
      const duration =
        SPARK_DURATION_MIN_MS +
        Math.random() * (SPARK_DURATION_MAX_MS - SPARK_DURATION_MIN_MS);

      spark.classList.remove("hero__spark--active");
      spark.style.setProperty("--spark-size", `${size}rem`);
      spark.style.setProperty("--spark-left", `${left}%`);
      spark.style.setProperty("--spark-bottom", `${bottom}%`);
      spark.style.setProperty("--spark-drift-x", `${driftX.toFixed(2)}rem`);
      spark.style.setProperty("--spark-rise", `${rise.toFixed(2)}rem`);
      spark.style.setProperty("--spark-duration", `${duration.toFixed(0)}ms`);
      void spark.offsetWidth;
      spark.classList.add("hero__spark--active");
    });
}

function cancelScheduledSparks() {
  if (sparkTimeoutId !== null) {
    window.clearTimeout(sparkTimeoutId);
    sparkTimeoutId = null;
  }
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
  if (!dogHeadElement || isDogAnimating) {
    return Promise.resolve();
  }

  isDogAnimating = true;
  dogHeadElement.classList.remove(DOG_HEAD_ANIMATION_CLASS);
  void dogHeadElement.offsetWidth;
  dogHeadElement.classList.add(DOG_HEAD_ANIMATION_CLASS);

  return new Promise((resolve) => {
    let completed = false;
    const handleAnimationEnd = () => {
      if (completed) {
        return;
      }

      completed = true;
      dogHeadElement.classList.remove(DOG_HEAD_ANIMATION_CLASS);
      isDogAnimating = false;
      resolve();
    };

    dogHeadElement.addEventListener("animationend", handleAnimationEnd, {
      once: true
    });

    window.setTimeout(
      handleAnimationEnd,
      prefersReducedMotion.matches
        ? DOG_HEAD_ANIMATION_REDUCED_DURATION_MS + 120
        : DOG_HEAD_ANIMATION_DURATION_MS + 120
    );
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

async function playDogMinuteEvent(minutes) {
  if (
    document.hidden ||
    minutes < 1 ||
    minutes > 9 ||
    howledMinutes.has(minutes) ||
    isDogAnimating
  ) {
    return false;
  }

  howledMinutes.add(minutes);

  window.setTimeout(() => {
    void playDogHeadAnimation();
  }, prefersReducedMotion.matches ? 0 : 180);

  await playDogHowl();
  return true;
}

function checkMinuteDogEvent(minutes, seconds, options = {}) {
  const { allowDogEvent = true } = options;

  if (!allowDogEvent || document.hidden || seconds !== 0 || minutes < 1 || minutes > 9) {
    return;
  }

  if (howledMinutes.has(minutes) || audioState.isHowlPlaying || isDogAnimating) {
    return;
  }

  void playDogMinuteEvent(minutes);
}

function updateTimer(options = {}) {
  const { allowDogEvent = true } = options;

  if (!timerElement) {
    return;
  }

  const remainingSeconds = getRemainingSeconds(countdownEndTime);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  timerElement.textContent = formatTime(remainingSeconds);
  checkMinuteDogEvent(minutes, seconds, { allowDogEvent });

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
  resetDogMinuteEvents();
  timerElement.textContent = "09:59";
  updateTimer({ allowDogEvent: false });
  timerIntervalId = window.setInterval(() => {
    updateTimer({ allowDogEvent: true });
  }, TIMER_TICK_MS);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelScheduledSparks();

    if (audioState.effects.dogHowl && !audioState.effects.dogHowl.paused) {
      audioState.effects.dogHowl.pause();
      audioState.effects.dogHowl.currentTime = 0;
    }

    audioState.isHowlPlaying = false;

    return;
  }

  updateTimer({ allowDogEvent: false });

  if (!audioState.ambientStarted) {
    void tryStartAmbientAudio();
  }

  scheduleNextSparkBurst();
});

initializeFireAnimation();
void initializeAudio().then(() => {
  void tryStartAmbientAudio();
});
startCountdown();
