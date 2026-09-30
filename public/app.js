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

    await initAudioStream();
    initSocketConnection();
  });

  copyLinkBtn.addEventListener('click', () => {
    const inviteUrl = `${window.location.origin}?room=${encodeURIComponent(currentRoom)}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      alert(`คัดลอกลิงก์ห้องเรียบร้อย: ${inviteUrl}\nส่งให้เพื่อนเข้าคุยเสียงได้ทันที!`);
    });
  });

  // Controls
  toggleMicBtn.addEventListener('click', toggleMicMute);
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

  sensitivitySlider.addEventListener('input', (e) => {
    sensitivityThreshold = parseInt(e.target.value, 10);
    sensitivityValueDisplay.textContent = `${sensitivityThreshold}%`;
    micThresholdLine.style.left = `${sensitivityThreshold}%`;
  });

  // Chat toggles
  toggleChatBtn.addEventListener('click', () => {
    chatSidebar.classList.toggle('hidden');
    chatBadge.classList.add('hidden');
  });
  closeChatBtn.addEventListener('click', () => {
    chatSidebar.classList.add('hidden');
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg && socket) {
      socket.emit('send-message', { message: msg });
      chatInput.value = '';
    }
  });

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
    document.body.classList.toggle('mini-mode');
  });
}

// =========================================================
// Audio Stream & Web Audio API
// =========================================================

async function initAudioStream() {
  try {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
      audio: {
        deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
        echoCancellation: echoCancellation,
        noiseSuppression: noiseSuppression,
        autoGainControl: true,
        // High quality audio latency optimization for games
        channelCount: 1,
        sampleRate: 48000
      },
      video: false
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Setup Web Audio API for level meter & VAD
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    micSourceNode = audioContext.createMediaStreamSource(localStream);
    micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 256;
    micSourceNode.connect(micAnalyser);

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
  } catch (err) {
    console.error('Failed to get local microphone:', err);
    alert('ไม่สามารถเข้าถึงไมโครโฟนได้ กรุณาอนุญาตการใช้งานไมค์ในบราวเซอร์');
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
    micMeterFill.style.width = `${volumePercentage}%`;

    // Handle Voice Activity Detection (VAD) / Push to Talk
    if (!isMuted && !isDeafened) {
      if (voiceMode === 'vad') {
        if (volumePercentage >= sensitivityThreshold) {
          setSpeakingState(true);
          if (vadReleaseTimeout) clearTimeout(vadReleaseTimeout);
          vadReleaseTimeout = setTimeout(() => {
            setSpeakingState(false);
          }, 300);
        }
      } else if (voiceMode === 'ptt') {
        if (isPttActive) {
          setSpeakingState(true);
        } else {
          setSpeakingState(false);
        }
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
    audioTrack.enabled = isSpeaking;
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
    toggleMicBtn.className = 'w-12 h-12 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 flex items-center justify-center text-lg transition-all shadow-[0_0_15px_rgba(255,75,92,0.2)]';
    toggleMicBtn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
    selfMicIconIndicator.className = 'fa-solid fa-microphone-slash text-red-400';
    selfMicStatusText.textContent = 'ปิดไมค์ (Muted)';
  } else {
    toggleMicBtn.className = 'w-12 h-12 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 flex items-center justify-center text-lg transition-all shadow-[0_0_15px_rgba(0,242,254,0.15)]';
    toggleMicBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    selfMicIconIndicator.className = 'fa-solid fa-microphone text-cyan-400';
    selfMicStatusText.textContent = 'พร้อมใช้งาน';
  }

  if (isDeafened) {
    toggleDeafenBtn.className = 'w-12 h-12 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 flex items-center justify-center text-lg transition-all shadow-[0_0_15px_rgba(255,75,92,0.2)]';
    toggleDeafenBtn.innerHTML = '<i class="fa-solid fa-headphones-simple"></i>';
  } else {
    toggleDeafenBtn.className = 'w-12 h-12 rounded-xl bg-[#161b24] hover:bg-[#202735] border border-gray-700 text-gray-300 flex items-center justify-center text-lg transition-all';
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
// Socket.io & WebRTC Peer Mesh Network
// =========================================================

function initSocketConnection() {
  socket = io();

  socket.on('connect', () => {
    console.log('[Socket Connected] Connected to signaling server');
    socket.emit('join-room', { roomId: currentRoom, username: currentUsername });
  });

  socket.on('room-joined', ({ roomId, yourSocketId, existingUsers }) => {
    console.log(`[Joined Room] ${roomId} as ID: ${yourSocketId}`);
    updateUserCount(existingUsers.length + 1);

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
          await pc.setLocalDescription(answer);
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
    appendChatMessage(username, message, timestamp, senderId === socket.id);
  });

  socket.on('user-disconnected', ({ socketId, username }) => {
    console.log(`[User Disconnected] ${username} (${socketId})`);
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

  // If initiator, create Offer
  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
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

function setupRemoteAudioElement(socketId, stream) {
  // Container for hidden audio tags
  const container = document.getElementById('remote-audio-container');
  let audioEl = peerAudioElements[socketId];

  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = `remote-audio-${socketId}`;
    audioEl.autoplay = true;
    audioEl.muted = isDeafened;
    container.appendChild(audioEl);
    peerAudioElements[socketId] = audioEl;
  }

  audioEl.srcObject = stream;

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
  // Check if card already exists
  if (document.getElementById(`user-card-${socketId}`)) return;

  const initial = username.charAt(0).toUpperCase();
  const card = document.createElement('div');
  card.id = `user-card-${socketId}`;
  card.className = 'parallel-card p-5 rounded-3xl flex flex-col items-center text-center justify-between relative overflow-hidden group min-h-[200px]';

  card.innerHTML = `
    <!-- Top Mute Badge -->
    <div class="absolute top-3 right-3 flex items-center gap-1.5" id="user-badges-${socketId}">
      <span id="badge-mute-${socketId}" class="hidden text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
        <i class="fa-solid fa-microphone-slash mr-1"></i> MUTED
      </span>
    </div>

    <!-- Center Avatar Tile with Parallel Outer Rings -->
    <div class="my-3 flex flex-col items-center">
      <div class="relative avatar-container my-2">
        <div id="avatar-ring-outer-${socketId}" class="avatar-ring-outer"></div>
        <div id="avatar-ring-${socketId}" class="avatar-ring"></div>
        <div class="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500 via-blue-600 to-purple-600 flex items-center justify-center font-bold text-white text-xl shadow-[0_0_20px_rgba(0,242,254,0.3)]">
          ${initial}
        </div>
      </div>
      <div class="text-sm font-bold text-white tracking-wide mt-2">${username}</div>
      <div class="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
        <span>CONNECTED</span>
      </div>
    </div>

    <!-- Bottom Volume Slider -->
    <div class="w-full mt-2 pt-3 border-t border-gray-800/80">
      <div class="flex justify-between items-center text-[10px] text-gray-400 mb-1">
        <span>VOL</span>
        <span id="volume-val-${socketId}" class="text-cyan-300 font-mono font-bold">100%</span>
      </div>
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-volume-high text-[10px] text-gray-500"></i>
        <input type="range" id="volume-slider-${socketId}" min="0" max="200" value="100" class="w-full">
      </div>
    </div>
  `;

  participantsGrid.appendChild(card);

  // Volume slider event listener
  const slider = document.getElementById(`volume-slider-${socketId}`);
  const valDisplay = document.getElementById(`volume-val-${socketId}`);

  slider.addEventListener('input', (e) => {
    const vol = parseInt(e.target.value, 10);
    valDisplay.textContent = `${vol}%`;
    userStates[socketId].volume = vol;

    const audioEl = peerAudioElements[socketId];
    if (audioEl) {
      audioEl.volume = vol / 100;
    }
  });
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

function appendChatMessage(username, message, timestamp, isSelf) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `p-2.5 rounded-xl border ${isSelf ? 'bg-cyan-500/10 border-cyan-500/30 ml-4' : 'bg-[#161b24] border-gray-800 mr-4'}`;

  msgDiv.innerHTML = `
    <div class="flex items-center justify-between mb-1">
      <span class="font-semibold ${isSelf ? 'text-cyan-300' : 'text-purple-300'}">${username}</span>
      <span class="text-[10px] text-gray-500">${timestamp}</span>
    </div>
    <div class="text-gray-200 break-words leading-relaxed">${escapeHtml(message)}</div>
  `;

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (chatSidebar.classList.contains('hidden')) {
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
