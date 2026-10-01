// =========================================================
// VOLC Gaming Voice Chat Application Logic
// =========================================================

// Socket & Peer Connections State
let socket = null;
let localStream = null;
let audioContext = null;
let micAnalyser = null;
let micSourceNode = null;
const peerConnections = {}; // { socketId: RTCPeerConnection }
const peerGainNodes = {};     // { socketId: GainNode }
const peerAudioElements = {};  // { socketId: HTMLAudioElement }
const userStates = {};        // { socketId: { username, muted, deafened, isSpeaking, volume } }

// User Settings State
let currentRoom = null;
let currentUsername = 'Gamer';
let isMuted = false;
let isDeafened = false;
let voiceMode = 'vad'; // 'vad' (Voice Activity) or 'ptt' (Push To Talk)
let sensitivityThreshold = 25; // 0 - 100%
let pttKey = 'Space';
let isPttActive = false;
let vadReleaseTimeout = null;

// Audio Constraints
let selectedMicId = '';
let selectedSpeakerId = '';
let echoCancellation = true;
let noiseSuppression = true;

// WebRTC ICE Configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// DOM Elements
const joinModal = document.getElementById('join-modal');
const joinForm = document.getElementById('join-form');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const randomRoomBtn = document.getElementById('random-room-btn');

const topNav = document.getElementById('top-nav');
const currentRoomDisplay = document.getElementById('current-room-display');
const copyLinkBtn = document.getElementById('copy-link-btn');
const userCountDisplay = document.getElementById('user-count-display');
const participantsGrid = document.getElementById('participants-grid');

const toggleMicBtn = document.getElementById('toggle-mic-btn');
const toggleDeafenBtn = document.getElementById('toggle-deafen-btn');
const pttTriggerBtn = document.getElementById('ptt-trigger-btn');
const pttKeyDisplay = document.getElementById('ptt-key-display');

const voiceModeSelect = document.getElementById('voice-mode-select');
const sensitivitySlider = document.getElementById('sensitivity-slider');
const sensitivityValueDisplay = document.getElementById('sensitivity-value-display');
const micMeterFill = document.getElementById('mic-meter-fill');
const micThresholdLine = document.getElementById('mic-threshold-line');

const selfUsernameDisplay = document.getElementById('self-username-display');
const selfAvatarText = document.getElementById('self-avatar-text');
const selfAvatarRing = document.getElementById('self-avatar-ring');
const selfStatusBadge = document.getElementById('self-status-badge');
const selfMicStatusText = document.getElementById('self-mic-status-text');
const selfMicIconIndicator = document.getElementById('self-mic-icon-indicator');

const toggleChatBtn = document.getElementById('toggle-chat-btn');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatSidebar = document.getElementById('chat-sidebar');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const chatBadge = document.getElementById('chat-badge');

const openSettingsBtn = document.getElementById('open-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const settingsModal = document.getElementById('settings-modal');
const micDeviceSelect = document.getElementById('mic-device-select');
const speakerDeviceSelect = document.getElementById('speaker-device-select');
const echoCancelCheck = document.getElementById('echo-cancel-check');
const noiseSuppressCheck = document.getElementById('noise-suppress-check');
const rebindPttBtn = document.getElementById('rebind-ptt-btn');
const keybindLabel = document.getElementById('keybind-label');
const saveSettingsBtn = document.getElementById('save-settings-btn');

const toggleMiniBtn = document.getElementById('toggle-mini-btn');

// PWA & Android/iOS Screen Wake Lock State
let deferredPrompt = null;
let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('[WakeLock] Active: Preventing Android/iOS CPU sleep while playing games');
    }
  } catch (err) {
    console.warn('[WakeLock Error]:', err);
  }
}

document.addEventListener('visibilitychange', () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    requestWakeLock();
  }
});

// Service Worker Registration for PWA App
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('[PWA ServiceWorker] Registered:', reg.scope);
    }).catch((err) => {
      console.warn('[PWA ServiceWorker] Registration failed:', err);
    });
  });
}

// Android PWA Install Event Handler
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const pwaInstallBtn = document.getElementById('pwa-install-btn');
  if (pwaInstallBtn) {
    pwaInstallBtn.classList.remove('hidden');
    pwaInstallBtn.addEventListener('click', () => {
      pwaInstallBtn.classList.add('hidden');
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            console.log('[PWA] User accepted install prompt');
          }
          deferredPrompt = null;
        });
      }
    });
  }
});

// =========================================================
// Initialization
// =========================================================

window.addEventListener('DOMContentLoaded', () => {
  // Check URL parameters for room code
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    roomInput.value = roomParam;
  } else {
    roomInput.value = generateRandomRoomId();
  }

  // Pre-fill username if saved
  const savedName = localStorage.getItem('volc_username');
  if (savedName) usernameInput.value = savedName;

  setupEventListeners();
});

function generateRandomRoomId() {
  const adjectives = ['Apex', 'Valor', 'Cyber', 'Neon', 'Shadow', 'Dragon', 'Titan', 'Viper'];
  const nouns = ['Squad', 'Team', 'Guild', 'Raid', 'Party', 'Zone', 'Hub'];
  const num = Math.floor(100 + Math.random() * 900);
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${nouns[Math.floor(Math.random() * nouns.length)]}-${num}`.toLowerCase();
}

// Discord Synthesized Web Audio SFX
function playDiscordSFX(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'join') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(739.99, now + 0.08);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'leave') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(739.99, now);
      osc.frequency.setValueAtTime(587.33, now + 0.08);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'mute') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.setValueAtTime(300, now + 0.06);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (type === 'unmute') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.setValueAtTime(450, now + 0.06);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    }
  } catch (err) {
    console.warn('SFX Error:', err);
  }
}

// Discord Screen Sharing State
let screenStream = null;

function setupEventListeners() {
  randomRoomBtn.addEventListener('click', () => {
    roomInput.value = generateRandomRoomId();
  });

  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    currentUsername = usernameInput.value.trim() || 'Gamer';
    currentRoom = roomInput.value.trim() || 'lobby';
    localStorage.setItem('volc_username', currentUsername);

    joinModal.classList.add('hidden');
    currentRoomDisplay.textContent = currentRoom;
    selfUsernameDisplay.textContent = currentUsername;
    selfAvatarText.textContent = currentUsername.charAt(0).toUpperCase();

    try {
      await initAudioStream();
    } catch (err) {
      console.warn('Audio stream init warning, joining room in listen mode:', err);
    }

    try {
      await requestWakeLock();
    } catch (err) {}

    playDiscordSFX('join');
    initSocketConnection();
  });

  copyLinkBtn.addEventListener('click', () => {
    const inviteUrl = `${window.location.origin}?room=${encodeURIComponent(currentRoom)}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      alert(`คัดลอกลิงก์เชิญเพื่อนเข้าร่วม VOLC PIXEL VOICE เรียบร้อย:\n${inviteUrl}`);
    });
  });

  // Discord Screen Share Button Handler
  const shareScreenBtn = document.getElementById('share-screen-btn');
  const screenShareContainer = document.getElementById('screen-share-container');
  const screenShareVideo = document.getElementById('screen-share-video');
  const screenShareUserName = document.getElementById('screen-share-user-name');

  if (shareScreenBtn) {
    shareScreenBtn.addEventListener('click', async () => {
      if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
        screenShareContainer.classList.add('hidden');
        shareScreenBtn.classList.remove('bg-red-500/20', 'text-red-400');
        shareScreenBtn.innerHTML = '<i class="fa-solid fa-desktop text-cyan-400"></i><span class="hidden sm:inline">แชร์หน้าจอเกม (Share Screen)</span>';
        return;
      }

      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        screenShareVideo.srcObject = screenStream;
        screenShareContainer.classList.remove('hidden');
        screenShareUserName.textContent = `${currentUsername} กำลังแชร์หน้าจอเกม...`;

        shareScreenBtn.classList.add('bg-red-500/20', 'text-red-400');
        shareScreenBtn.innerHTML = '<i class="fa-solid fa-xmark mr-1"></i> เลิกแชร์หน้าจอ';

        screenStream.getVideoTracks()[0].onended = () => {
          screenStream = null;
          screenShareContainer.classList.add('hidden');
          shareScreenBtn.classList.remove('bg-red-500/20', 'text-red-400');
          shareScreenBtn.innerHTML = '<i class="fa-solid fa-desktop text-cyan-400"></i><span class="hidden sm:inline">แชร์หน้าจอเกม (Share Screen)</span>';
        };
      } catch (err) {
        console.warn('Screen share canceled or failed:', err);
      }
    });
  }

  // Discord Voice Channel Switchers
  document.querySelectorAll('.voice-channel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const channel = btn.getAttribute('data-channel');
      document.querySelectorAll('.voice-channel-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const channelName = btn.querySelector('span').textContent;
      const channelDisplay = document.getElementById('channel-name-display');
      if (channelDisplay) channelDisplay.textContent = channelName;

      playDiscordSFX('join');

      if (socket && currentRoom) {
        socket.emit('join-room', { roomId: `${currentRoom}-${channel}`, username: currentUsername });
      }
    });
  });

  // Controls
  toggleMicBtn.addEventListener('click', () => {
    toggleMicMute();
    playDiscordSFX(isMuted ? 'mute' : 'unmute');
  });
  toggleDeafenBtn.addEventListener('click', toggleDeafen);

  // On-screen PTT Touch & Mouse press events for mobile/tablet
  const startPttPress = (e) => {
    e.preventDefault();
    if (voiceMode === 'ptt' && !isPttActive) {
      isPttActive = true;
      pttTriggerBtn.classList.add('scale-95', 'brightness-125');
      setSpeakingState(true);
    }
  };

  const endPttPress = (e) => {
    e.preventDefault();
    if (voiceMode === 'ptt' && isPttActive) {
      isPttActive = false;
      pttTriggerBtn.classList.remove('scale-95', 'brightness-125');
      setSpeakingState(false);
    }
  };

  pttTriggerBtn.addEventListener('mousedown', startPttPress);
  pttTriggerBtn.addEventListener('mouseup', endPttPress);
  pttTriggerBtn.addEventListener('mouseleave', endPttPress);
  pttTriggerBtn.addEventListener('touchstart', startPttPress, { passive: false });
  pttTriggerBtn.addEventListener('touchend', endPttPress, { passive: false });

  voiceModeSelect.addEventListener('change', (e) => {
    voiceMode = e.target.value;
    selfStatusBadge.textContent = voiceMode === 'vad' ? 'VAD' : 'PTT';
    if (voiceMode === 'ptt') {
      pttTriggerBtn.classList.remove('hidden');
    } else {
      pttTriggerBtn.classList.add('hidden');
    }
  });

  if (sensitivitySlider) {
    sensitivitySlider.addEventListener('input', (e) => {
      sensitivityThreshold = parseInt(e.target.value, 10);
      if (sensitivityValueDisplay) sensitivityValueDisplay.textContent = `${sensitivityThreshold}%`;
    });
  }

  // Chat toggles & message sending
  toggleChatBtn.addEventListener('click', () => {
    chatSidebar.classList.toggle('hidden');
    chatBadge.classList.add('hidden');
    if (!chatSidebar.classList.contains('hidden')) {
      chatInput.focus();
    }
  });
  closeChatBtn.addEventListener('click', () => {
    chatSidebar.classList.add('hidden');
  });

  window.handleSendMessage = function() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Render message immediately on sender's screen for 100% instant feedback
    appendChatMessage(currentUsername || 'Gamer', msg, timestamp, true);

    // Send payload to signaling server for room distribution
    if (socket && socket.connected) {
      socket.emit('send-message', { message: msg });
    }

    input.value = '';
    setTimeout(() => {
      input.focus();
    }, 50);
  };

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      window.handleSendMessage();
    });
  }

  // Settings Modal
  openSettingsBtn.addEventListener('click', () => {
    populateAudioDevices();
    settingsModal.classList.remove('hidden');
  });
  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });
  saveSettingsBtn.addEventListener('click', async () => {
    selectedMicId = micDeviceSelect.value;
    selectedSpeakerId = speakerDeviceSelect.value;
    echoCancellation = echoCancelCheck.checked;
    noiseSuppression = noiseSuppressCheck.checked;

    settingsModal.classList.add('hidden');
    await initAudioStream();
  });

  // Keybindings for PTT
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  rebindPttBtn.addEventListener('click', () => {
    keybindLabel.textContent = 'กดปุ่มใดก็ได้บนคีย์บอร์ด...';
    const captureKey = (e) => {
      e.preventDefault();
      pttKey = e.code;
      keybindLabel.textContent = pttKey;
      pttKeyDisplay.textContent = pttKey.toUpperCase();
      window.removeEventListener('keydown', captureKey);
    };
    window.addEventListener('keydown', captureKey);
  });

  // Compact Mode Toggle
  toggleMiniBtn.addEventListener('click', () => {
    const isMini = document.body.classList.toggle('mini-mode');
    const icon = toggleMiniBtn.querySelector('i');
    if (icon) {
      if (isMini) {
        icon.className = 'fa-solid fa-expand text-xs text-[#00ff9d]';
        toggleMiniBtn.setAttribute('data-tooltip', 'ขยายหน้าจอปกติ');
      } else {
        icon.className = 'fa-solid fa-compress text-xs';
        toggleMiniBtn.setAttribute('data-tooltip', 'ย่อหน้าจอโหมด Overlay');
      }
    }
  });
}

// =========================================================
// Audio Stream & Web Audio API (DSP & Auto Noise Suppression)
// =========================================================

let highpassFilterNode = null;
let compressorNode = null;
let ambientNoiseFloor = 8; // Dynamic ambient noise baseline

async function initAudioStream() {
  try {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('getUserMedia not supported or blocked by non-HTTPS origin');
      alert('⚠️ หมายเหตุ: บราวเซอร์บล็อกไมค์เนื่องจากไม่ได้รันบน HTTPS แต่คุณยังสามารถเข้าร่วมห้องเพื่อฟังเสียงเพื่อนๆ ได้แบบ Listen-Only!');
      return false;
    }

    const constraints = {
      audio: {
        deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
        googEchoCancellation: { ideal: true },
        googAutoGainControl: { ideal: true },
        googNoiseSuppression: { ideal: true },
        googHighpassFilter: { ideal: true },
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 },
        latency: { ideal: 0.005 }
      },
      video: false
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Setup Web Audio API with low latency interactive mode
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    micSourceNode = audioContext.createMediaStreamSource(localStream);

    // 1. High-Pass Filter (85Hz) -> Cut low frequency hum, AC fan, desktop vibrations
    highpassFilterNode = audioContext.createBiquadFilter();
    highpassFilterNode.type = 'highpass';
    highpassFilterNode.frequency.setValueAtTime(85, audioContext.currentTime);

    // 2. Dynamics Compressor -> Auto Gain Control (AGC) & Peak Vocal Limiter to eliminate clipping & feedback echoes
    compressorNode = audioContext.createDynamicsCompressor();
    compressorNode.threshold.setValueAtTime(-24, audioContext.currentTime);
    compressorNode.knee.setValueAtTime(12, audioContext.currentTime);
    compressorNode.ratio.setValueAtTime(4, audioContext.currentTime);
    compressorNode.attack.setValueAtTime(0.003, audioContext.currentTime);
    compressorNode.release.setValueAtTime(0.25, audioContext.currentTime);

    // 3. Analyser Node
    micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 256;

    // Connect DSP pipeline: micSourceNode -> highpassFilterNode -> compressorNode -> micAnalyser
    micSourceNode.connect(highpassFilterNode);
    highpassFilterNode.connect(compressorNode);
    compressorNode.connect(micAnalyser);

    startMicLevelMonitoring();

    // Replace tracks in active peer connections if re-initializing
    Object.values(peerConnections).forEach(pc => {
      const senders = pc.getSenders();
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (audioSender && localStream.getAudioTracks()[0]) {
        audioSender.replaceTrack(localStream.getAudioTracks()[0]);
      }
    });

    updateMicStateDisplay();
    return true;
  } catch (err) {
    console.error('Failed to get local microphone:', err);
    alert('ไม่สามารถเปิดไมค์ได้ (คุณสามารถเข้าร่วมห้องเพื่อฟังเสียงเพื่อนๆ ได้ปกติ)');
    return false;
  }
}

function startMicLevelMonitoring() {
  const dataArray = new Uint8Array(micAnalyser.frequencyBinCount);

  function checkLevel() {
    micAnalyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    const volumePercentage = Math.min(100, Math.round((average / 128) * 100));

    // Update mic meter fill in UI
    if (micMeterFill) micMeterFill.style.width = `${volumePercentage}%`;

    // Smart Noise Floor Tracking (Auto adapts baseline threshold - 0 adjustment required by user)
    if (volumePercentage < ambientNoiseFloor) {
      ambientNoiseFloor = Math.max(3, ambientNoiseFloor * 0.9 + volumePercentage * 0.1);
    } else {
      ambientNoiseFloor = ambientNoiseFloor * 0.998 + volumePercentage * 0.002;
    }

    // Calculated dynamic auto threshold (+5dB above ambient noise floor)
    const autoAdaptiveThreshold = Math.max(5, Math.min(40, Math.round(ambientNoiseFloor + 5)));

    // Handle Voice Activity Detection (VAD) / Push to Talk
    if (!isMuted && !isDeafened) {
      if (voiceMode === 'vad') {
        if (volumePercentage >= autoAdaptiveThreshold) {
          setSpeakingState(true);
          if (vadReleaseTimeout) clearTimeout(vadReleaseTimeout);
          vadReleaseTimeout = setTimeout(() => {
            setSpeakingState(false);
          }, 300);
        }
      } else if (voiceMode === 'ptt') {
        setSpeakingState(isPttActive);
      }
    } else {
      setSpeakingState(false);
    }

    requestAnimationFrame(checkLevel);
  }

  checkLevel();
}

function setSpeakingState(isSpeaking) {
  const audioTrack = localStream ? localStream.getAudioTracks()[0] : null;

  if (isMuted || isDeafened) {
    if (audioTrack) audioTrack.enabled = false;
    selfAvatarRing.parentElement.classList.remove('speaking');
    emitStatusChange(false);
    return;
  }

  if (audioTrack) {
    if (voiceMode === 'vad') {
      // In VAD mode, mic track remains enabled so audio transmits continuously without truncation
      audioTrack.enabled = true;
    } else {
      // In PTT mode, mic track enables only when holding key/button
      audioTrack.enabled = isSpeaking;
    }
  }

  if (isSpeaking) {
    selfAvatarRing.parentElement.classList.add('speaking');
  } else {
    selfAvatarRing.parentElement.classList.remove('speaking');
  }

  emitStatusChange(isSpeaking);
}

function emitStatusChange(isSpeaking) {
  if (socket && socket.connected) {
    socket.emit('update-status', {
      muted: isMuted,
      deafened: isDeafened,
      isSpeaking: isSpeaking
    });
  }
}

function toggleMicMute() {
  isMuted = !isMuted;
  updateMicStateDisplay();
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = !isMuted && !isDeafened;
  }
  emitStatusChange(false);
}

function toggleDeafen() {
  isDeafened = !isDeafened;
  if (isDeafened) {
    isMuted = true;
  }
  updateMicStateDisplay();

  // Mute/Unmute all remote audio elements
  Object.values(peerAudioElements).forEach(audioEl => {
    audioEl.muted = isDeafened;
  });

  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = !isMuted && !isDeafened;
  }
  emitStatusChange(false);
}

function updateMicStateDisplay() {
  if (isMuted) {
    toggleMicBtn.className = 'p-3 pixel-btn pixel-btn-magenta text-base';
    toggleMicBtn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
    selfMicIconIndicator.className = 'fa-solid fa-microphone-slash text-[#ff007f]';
    selfMicStatusText.textContent = 'MUTED';
  } else {
    toggleMicBtn.className = 'p-3 pixel-btn text-base';
    toggleMicBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    selfMicIconIndicator.className = 'fa-solid fa-microphone text-[#00ff9d]';
    selfMicStatusText.textContent = 'ONLINE';
  }

  if (isDeafened) {
    toggleDeafenBtn.className = 'p-3 pixel-btn pixel-btn-magenta text-base';
    toggleDeafenBtn.innerHTML = '<i class="fa-solid fa-headphones-simple"></i>';
  } else {
    toggleDeafenBtn.className = 'p-3 pixel-btn text-base';
    toggleDeafenBtn.innerHTML = '<i class="fa-solid fa-headphones"></i>';
  }
}

// PTT Key Handlers
function handleKeyDown(e) {
  if (voiceMode === 'ptt' && e.code === pttKey && !isPttActive && document.activeElement.tagName !== 'INPUT') {
    isPttActive = true;
    pttTriggerBtn.classList.add('scale-95', 'brightness-125');
    setSpeakingState(true);
  }
}

function handleKeyUp(e) {
  if (voiceMode === 'ptt' && e.code === pttKey) {
    isPttActive = false;
    pttTriggerBtn.classList.remove('scale-95', 'brightness-125');
    setSpeakingState(false);
  }
}

// Device Listing
async function populateAudioDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    micDeviceSelect.innerHTML = '';
    speakerDeviceSelect.innerHTML = '<option value="">อุปกรณ์เริ่มต้น (Default Output)</option>';

    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Device ${device.deviceId.substring(0, 5)}`;

      if (device.kind === 'audioinput') {
        micDeviceSelect.appendChild(option);
      } else if (device.kind === 'audiooutput') {
        speakerDeviceSelect.appendChild(option);
      }
    });

    if (selectedMicId) micDeviceSelect.value = selectedMicId;
    if (selectedSpeakerId) speakerDeviceSelect.value = selectedSpeakerId;
  } catch (err) {
    console.error('Error populating audio devices:', err);
  }
}

// =========================================================
// Socket.io & WebRTC Peer Mesh Network (Low-Latency SDP Optimization)
// =========================================================

function optimizeAudioSdp(sdp) {
  if (!sdp) return sdp;
  let lines = sdp.split('\r\n');
  let opusPt = null;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('a=rtpmap:') && lines[i].toLowerCase().includes('opus/48000')) {
      const match = lines[i].match(/a=rtpmap:(\d+)/);
      if (match) opusPt = match[1];
    }
  }

  if (opusPt) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(`a=fmtp:${opusPt}`)) {
        lines[i] = `${lines[i]};minptime=10;useinbandfec=1;stereo=0;sprop-maxcapturerate=48000;maxaveragebitrate=128000;cbr=1`;
      }
    }
  }

  return lines.join('\r\n');
}

function initSocketConnection() {
  socket = io();

  socket.on('connect', () => {
    console.log('[Socket Connected] Connected to signaling server');
    socket.emit('join-room', { roomId: currentRoom, username: currentUsername });
  });

  socket.on('room-joined', ({ roomId, yourSocketId, existingUsers }) => {
    console.log(`[Joined Room] ${roomId} as ID: ${yourSocketId}`);
    updateUserCount(existingUsers.length + 1);
    appendSystemMessage(`เข้าร่วมห้อง [${roomId}] เรียบร้อยแล้ว!`);

    // Create RTCPeerConnection for each existing user
    existingUsers.forEach(user => {
      userStates[user.socketId] = {
        username: user.username,
        muted: user.muted,
        deafened: user.deafened,
        isSpeaking: false,
        volume: 100
      };
      addUserCardToGrid(user.socketId, user.username);
      createPeerConnection(user.socketId, true); // true = initiator
    });
  });

  socket.on('user-connected', ({ socketId, username }) => {
    console.log(`[User Joined] ${username} (${socketId})`);
    userStates[socketId] = {
      username: username,
      muted: false,
      deafened: false,
      isSpeaking: false,
      volume: 100
    };
    addUserCardToGrid(socketId, username);
    updateUserCount(Object.keys(userStates).length + 1);
    appendSystemMessage(`ผู้เล่น ${username} เข้าร่วมห้องแล้ว`);
    playDiscordSFX('join');
  });

  socket.on('signal', async ({ senderSocketId, signal }) => {
    let pc = peerConnections[senderSocketId];
    if (!pc) {
      pc = createPeerConnection(senderSocketId, false);
    }

    try {
      if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (signal.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          const optimizedAnswer = new RTCSessionDescription({
            type: answer.type,
            sdp: optimizeAudioSdp(answer.sdp)
          });
          await pc.setLocalDescription(optimizedAnswer);
          socket.emit('signal', {
            targetSocketId: senderSocketId,
            signal: { sdp: pc.localDescription }
          });
        }
      } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.error('Signal handling error:', err);
    }
  });

  socket.on('user-status-changed', ({ socketId, muted, deafened, isSpeaking }) => {
    if (userStates[socketId]) {
      userStates[socketId].muted = muted;
      userStates[socketId].deafened = deafened;
      userStates[socketId].isSpeaking = isSpeaking;
      updateUserCardStatus(socketId);
    }
  });

  socket.on('new-message', ({ senderId, username, message, timestamp }) => {
    if (senderId !== socket.id) {
      appendChatMessage(username, message, timestamp, false);
    }
  });

  socket.on('user-disconnected', ({ socketId, username }) => {
    console.log(`[User Disconnected] ${username} (${socketId})`);
    appendSystemMessage(`ผู้เล่น ${username || 'Gamer'} ออกจากห้องแล้ว`);
    playDiscordSFX('leave');
    removeUserFromRoom(socketId);
  });
}

function createPeerConnection(targetSocketId, isInitiator) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[targetSocketId] = pc;

  // Add local stream tracks to PC
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', {
        targetSocketId: targetSocketId,
        signal: { candidate: event.candidate }
      });
    }
  };

  // Handle incoming remote audio track
  pc.ontrack = (event) => {
    console.log(`[Remote Track Received] From ${targetSocketId}`);
    const remoteStream = event.streams[0];
    setupRemoteAudioElement(targetSocketId, remoteStream);
  };

  // If initiator, create Offer with SDP optimization
  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        const optimizedOffer = new RTCSessionDescription({
          type: offer.type,
          sdp: optimizeAudioSdp(offer.sdp)
        });
        await pc.setLocalDescription(optimizedOffer);
        socket.emit('signal', {
          targetSocketId: targetSocketId,
          signal: { sdp: pc.localDescription }
        });
      } catch (err) {
        console.error('Error creating offer:', err);
      }
    };
  }

  return pc;
}

// Autoplay Unlock Handler
const autoplayBanner = document.getElementById('autoplay-banner');

function unlockAudio() {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
  Object.values(peerAudioElements).forEach(audioEl => {
    if (audioEl.srcObject) {
      audioEl.play().then(() => {
        if (autoplayBanner) autoplayBanner.classList.add('hidden');
      }).catch(err => {
        console.warn('Autoplay unlock attempt:', err);
      });
    }
  });
}

window.addEventListener('click', unlockAudio);
window.addEventListener('touchstart', unlockAudio);
if (autoplayBanner) {
  autoplayBanner.addEventListener('click', unlockAudio);
}

function setupRemoteAudioElement(socketId, stream) {
  // Container for remote audio streams
  const container = document.getElementById('remote-audio-container');
  let audioEl = peerAudioElements[socketId];

  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = `remote-audio-${socketId}`;
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.volume = (userStates[socketId] && userStates[socketId].volume !== undefined ? userStates[socketId].volume : 100) / 100;
    audioEl.muted = isDeafened;
    container.appendChild(audioEl);
    peerAudioElements[socketId] = audioEl;
  }

  audioEl.srcObject = stream;

  // Explicitly trigger play and handle browser autoplay policy
  const playPromise = audioEl.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      console.log(`[Audio Playing] Remote stream active for ${socketId}`);
      if (autoplayBanner) autoplayBanner.classList.add('hidden');
    }).catch(err => {
      console.warn(`[Autoplay Blocked] Click to enable audio:`, err);
      if (autoplayBanner) autoplayBanner.classList.remove('hidden');
    });
  }

  // Route audio to specific speaker device if supported (setSinkId)
  if (selectedSpeakerId && typeof audioEl.setSinkId === 'function') {
    audioEl.setSinkId(selectedSpeakerId).catch(err => {
      console.warn('setSinkId failed:', err);
    });
  }
}

// =========================================================
// UI Renderers & Helpers
// =========================================================

function updateUserCount(count) {
  userCountDisplay.textContent = count;
}

function addUserCardToGrid(socketId, username) {
  if (document.getElementById(`user-card-${socketId}`)) return;

  const initial = username.charAt(0).toUpperCase();
  const card = document.createElement('div');
  card.id = `user-card-${socketId}`;
  card.className = 'pixel-box p-4 flex flex-col items-center text-center justify-between relative overflow-hidden group min-h-[190px] font-pixel';

  card.innerHTML = `
    <!-- Top Mute Badge -->
    <div class="absolute top-2 right-2 flex items-center gap-1.5 z-10" id="user-badges-${socketId}">
      <span id="badge-mute-${socketId}" class="hidden text-[9px] font-bold text-[#ff007f] bg-[#ff007f]/10 px-2 py-0.5 border border-[#ff007f]">
        <i class="fa-solid fa-microphone-slash mr-1"></i> MUTED
      </span>
    </div>

    <!-- Center Avatar Tile with Outer Waves -->
    <div class="my-2 flex flex-col items-center">
      <div class="relative avatar-container my-2">
        <div id="avatar-ring-outer-${socketId}" class="avatar-ring-outer"></div>
        <div id="avatar-ring-${socketId}" class="avatar-ring"></div>
        <div class="w-14 h-14 bg-[#161628] border-2 border-[#00f2fe] flex items-center justify-center font-bold text-[#00f2fe] text-xl shadow-[3px_3px_0px_#00ff9d]">
          ${initial}
        </div>
      </div>
      <div class="text-xs font-bold text-white tracking-wide mt-2 truncate max-w-[140px]">${username}</div>
      <div class="text-[9px] text-[#00ff9d] flex items-center gap-1 mt-0.5 font-mono">
        <span class="w-1.5 h-1.5 bg-[#00ff9d] animate-pulse"></span>
        <span>CONNECTED</span>
      </div>
    </div>

    <!-- Volume Control Slider -->
    <div class="w-full mt-2 pt-2 border-t border-[#333355]">
      <div class="flex justify-between items-center text-[9px] text-[#8a8ab0] mb-1 font-bold">
        <span>> VOLUME</span>
        <span id="volume-val-${socketId}" class="text-[#00f2fe] font-mono">100%</span>
      </div>
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-volume-high text-[9px] text-[#8a8ab0]"></i>
        <input type="range" id="volume-slider-${socketId}" min="0" max="200" value="100" class="w-full">
      </div>
    </div>
  `;

  participantsGrid.appendChild(card);

  const slider = document.getElementById(`volume-slider-${socketId}`);
  const valDisplay = document.getElementById(`volume-val-${socketId}`);

  if (slider) {
    slider.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10);
      if (valDisplay) valDisplay.textContent = `${vol}%`;
      if (userStates[socketId]) userStates[socketId].volume = vol;

      const audioEl = peerAudioElements[socketId];
      if (audioEl) {
        audioEl.volume = vol / 100;
      }
    });
  }
}

function updateUserCardStatus(socketId) {
  const state = userStates[socketId];
  if (!state) return;

  const ring = document.getElementById(`avatar-ring-${socketId}`);
  const muteBadge = document.getElementById(`badge-mute-${socketId}`);

  if (ring) {
    if (state.isSpeaking && !state.muted) {
      ring.parentElement.classList.add('speaking');
    } else {
      ring.parentElement.classList.remove('speaking');
    }
  }

  if (muteBadge) {
    if (state.muted) {
      muteBadge.classList.remove('hidden');
    } else {
      muteBadge.classList.add('hidden');
    }
  }
}

function removeUserFromRoom(socketId) {
  // Close peer connection
  if (peerConnections[socketId]) {
    peerConnections[socketId].close();
    delete peerConnections[socketId];
  }

  // Remove audio element
  if (peerAudioElements[socketId]) {
    peerAudioElements[socketId].remove();
    delete peerAudioElements[socketId];
  }

  delete userStates[socketId];

  // Remove UI card
  const card = document.getElementById(`user-card-${socketId}`);
  if (card) card.remove();

  updateUserCount(Object.keys(userStates).length + 1);
}

function appendSystemMessage(text) {
  if (!chatMessages) return;
  const msgDiv = document.createElement('div');
  msgDiv.className = 'p-2 border border-[#00f2fe]/30 bg-[#161628] text-[10px] text-[#00ff9d] font-pixel my-1.5 text-center shadow-[2px_2px_0px_#000000]';
  msgDiv.innerHTML = `> [SYSTEM] ${escapeHtml(text)}`;
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (chatSidebar && chatSidebar.classList.contains('hidden') && chatBadge) {
    chatBadge.classList.remove('hidden');
  }
}

function appendChatMessage(username, message, timestamp, isSelf) {
  if (!chatMessages) return;
  const msgDiv = document.createElement('div');
  msgDiv.className = `p-2.5 border font-pixel text-xs ${
    isSelf 
      ? 'bg-[#00f2fe]/10 border-[#00f2fe] text-[#00f2fe] ml-3' 
      : 'bg-[#161628] border-[#333355] text-gray-200 mr-3'
  } shadow-[2px_2px_0px_#000000] my-1.5`;

  msgDiv.innerHTML = `
    <div class="flex items-center justify-between mb-1">
      <span class="font-bold text-xs ${isSelf ? 'text-[#00ff9d]' : 'text-[#ff007f]'}">${escapeHtml(username)}</span>
      <span class="text-[9px] text-[#8a8ab0] font-mono">${timestamp}</span>
    </div>
    <div class="break-words leading-relaxed text-xs font-mono text-gray-200">${escapeHtml(message)}</div>
  `;

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (!isSelf) {
    playDiscordSFX('unmute');
  }

  if (chatSidebar && chatSidebar.classList.contains('hidden') && chatBadge) {
    chatBadge.classList.remove('hidden');
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}
