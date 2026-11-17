(() => {
  const REFRESH_INTERVAL_SEC = 25;
  const ALARM_THRESHOLD_MIN = 5;

  const INITIAL_PARADAS = [
    {
      id: 'chacabuco-pedernera-500sur',
      identificador: 'SL10094',
      nombre: 'Chacabuco y Pedernera',
      sentido: 'Hacia Bº 500 Viv. Sur',
      sentidoCorto: '500 SUR',
      grupo: '500sur',
      referenciaUsuario: 'chacabuco,pedernera,500sur',
      latitud: -33.300135,
      longitud: -66.339954,
      arribos: [],
      proximoArribo: null,
      error: 'Consultando Transpuntano en vivo...'
    },
    {
      id: 'chacabuco-9dejulio-500sur',
      identificador: 'SL10096',
      nombre: 'Chacabuco y 9 de Julio',
      sentido: 'Hacia Bº 500 Viv. Sur',
      sentidoCorto: '500 SUR',
      grupo: '500sur',
      referenciaUsuario: 'chacabuco,9dejulio,hacia500sur',
      latitud: -33.306826,
      longitud: -66.337851,
      arribos: [],
      proximoArribo: null,
      error: 'Consultando Transpuntano en vivo...'
    },
    {
      id: 'mirador-parada2-centro',
      identificador: 'SL10052',
      nombre: 'Mirador del Portezuelo • Parada 2',
      sentido: 'Hacia el Centro',
      sentidoCorto: 'HACIA CENTRO',
      grupo: 'haciacentro',
      referenciaUsuario: 'miradordelportezuelo,parada2,haciacentro',
      latitud: -33.328082,
      longitud: -66.310193,
      arribos: [],
      proximoArribo: null,
      error: 'Consultando Transpuntano en vivo...'
    }
  ];

  const state = {
    paradas: INITIAL_PARADAS,
    recorridos: [],
    filter: 'all',
    userLocation: null, // { lat, lng }
    globalAlarm: localStorage.getItem('oksur_global_alarm') === 'true',
    stopAlarms: JSON.parse(localStorage.getItem('oksur_stop_alarms') || '{}'),
    notifiedKeys: new Set(),
    countdown: REFRESH_INTERVAL_SEC,
    isFetching: false,
    deferredInstallPrompt: null,
    map: null,
    mapLayers: {
      routes: null,
      stops: null,
      buses: null,
      user: null
    }
  };

  // Elementos del DOM
  const els = {
    currentClock: document.getElementById('currentClock'),
    lastSyncText: document.getElementById('lastSyncText'),
    countdownText: document.getElementById('countdownText'),
    refreshProgressBar: document.getElementById('refreshProgressBar'),
    liveStatusPill: document.getElementById('liveStatusPill'),
    liveStatusText: document.getElementById('liveStatusText'),
    heroStopName: document.getElementById('heroStopName'),
    heroStopDirection: document.getElementById('heroStopDirection'),
    heroTimeClock: document.getElementById('heroTimeClock'),
    heroEtaBadge: document.getElementById('heroEtaBadge'),
    stopsContainer: document.getElementById('stopsContainer'),
    btnGlobalAlarm: document.getElementById('btnGlobalAlarm'),
    alarmIcon: document.getElementById('alarmIcon'),
    btnRefreshTop: document.getElementById('btnRefreshTop'),
    fabRefresh: document.getElementById('fabRefresh'),
    fabIcon: document.getElementById('fabIcon'),
    androidInstallBanner: document.getElementById('androidInstallBanner'),
    btnInstallDirect: document.getElementById('btnInstallDirect'),
    btnDismissInstall: document.getElementById('btnDismissInstall'),
    btnInstallHeader: document.getElementById('btnInstallHeader'),
    nativeInstallBox: document.getElementById('nativeInstallBox'),
    btnTriggerNativeInstall: document.getElementById('btnTriggerNativeInstall'),
    lanUrlCode: document.getElementById('lanUrlCode'),
    btnCopyLanUrl: document.getElementById('btnCopyLanUrl'),
    qrContainer: document.getElementById('qrContainer'),
    mapBusStatusFooter: document.getElementById('mapBusStatusFooter'),
    toastMessage: document.getElementById('toastMessage')
  };

  // =========================================================================
  // 1. RELOJ EN VIVO Y AUTO-REFRESCO
  // =========================================================================
  function updateClock() {
    const now = new Date();
    els.currentClock.textContent = now.toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/San_Luis',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  function tickCountdown() {
    updateClock();
    if (state.isFetching) return;

    state.countdown -= 1;
    if (state.countdown <= 0) {
      state.countdown = REFRESH_INTERVAL_SEC;
      fetchArribos(false);
    }

    els.countdownText.textContent = `${state.countdown}s`;
    const pct = Math.max(0, Math.min(1, state.countdown / REFRESH_INTERVAL_SEC));
    els.refreshProgressBar.style.transform = `scaleX(${pct})`;
  }

  // =========================================================================
  // 2. SONIDO Y NOTIFICACIONES DE ALERTA (CUANDO LLEGA EN <= 5 MIN)
  // =========================================================================
  function playAlertChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const notes = [587.33, 880, 1174.66]; // D5, A5, D6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.14);
        gain.gain.setValueAtTime(0.18, ctx.currentTime + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.14 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.14);
        osc.stop(ctx.currentTime + idx * 0.14 + 0.36);
      });
    } catch (_) {}
  }

  function showToast(msg, duration = 3800) {
    els.toastMessage.textContent = msg;
    els.toastMessage.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      els.toastMessage.classList.add('hidden');
    }, duration);
  }

  async function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (_) {}
    }
  }

  function checkAndTriggerAlarms(paradas) {
    paradas.forEach((parada) => {
      const isAlarmActive = state.globalAlarm || state.stopAlarms[parada.identificador];
      if (!isAlarmActive || !parada.proximoArribo) return;

      const arribo = parada.proximoArribo;
      if (arribo.minutos !== null && arribo.minutos <= ALARM_THRESHOLD_MIN) {
        // Clave por ventana de 3 minutos para no repetir cada 25s el mismo aviso
        const bucket = Math.floor(Date.now() / (3 * 60 * 1000));
        const key = `${parada.identificador}:${arribo.minutos <= 0 ? 'now' : 'soon'}:${bucket}`;
        if (state.notifiedKeys.has(key)) return;
        state.notifiedKeys.add(key);

        const textoTiempo = arribo.esArribando
          ? '¡ESTÁ ARRIBANDO AHORA!'
          : `llega a las ${arribo.horaLlegada} hs (${arribo.minutos} min aprox.)`;

        const bodyMsg = `🚌 OK SUR en ${parada.nombre} (${parada.sentidoCorto}): ${textoTiempo}`;
        playAlertChime();

        if (navigator.vibrate) {
          navigator.vibrate([300, 120, 300, 120, 400]);
        }

        showToast(bodyMsg, 6000);

        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification('🚌 ¡Se acerca el OK SUR!', {
              body: bodyMsg,
              icon: '/icons/icon-192.png',
              tag: parada.identificador
            });
          } catch (_) {}
        }
      }
    });
  }

  function updateGlobalAlarmUi() {
    els.alarmIcon.textContent = state.globalAlarm ? '🔔' : '🔕';
    els.btnGlobalAlarm.classList.toggle('active', state.globalAlarm);
  }

  // =========================================================================
  // 3. CÁLCULO DE DISTANCIA DEL USUARIO A LAS PARADAS (GPS CELULAR)
  // =========================================================================
  function calcDistanceMeters(lat1, lon1, lat2, lon2) {
    if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) {
      return null;
    }
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  function formatMeters(m) {
    if (m === null || m === undefined) return '';
    return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
  }

  // =========================================================================
  // 4. RENDERIZADO DE PARADAS Y HORARIOS
  // =========================================================================
  function updateHeroBanner(paradas) {
    const conArribo = paradas
      .filter((p) => p.proximoArribo && p.proximoArribo.minutos !== null)
      .sort((a, b) => a.proximoArribo.minutos - b.proximoArribo.minutos);

    if (conArribo.length === 0) {
      els.heroStopName.textContent = 'Sin unidades próximas reportadas';
      els.heroStopDirection.textContent = 'Transpuntano actualizará cuando salga la próxima unidad';
      els.heroTimeClock.textContent = '--:--';
      els.heroEtaBadge.textContent = 'En espera';
      return;
    }

    const best = conArribo[0];
    const arr = best.proximoArribo;
    els.heroStopName.textContent = best.nombre;
    els.heroStopDirection.textContent = `${best.sentido} • Parada ${best.identificador}`;
    els.heroTimeClock.textContent = arr.esArribando ? 'AHORA' : `${arr.horaLlegada} hs`;
    els.heroEtaBadge.textContent = arr.esArribando
      ? '🟢 ¡Arribando!'
      : `En ${arr.minutos} min aprox.`;
  }

  function getFilteredAndSortedStops() {
    let list = [...state.paradas];

    if (state.filter === '500sur') {
      list = list.filter((p) => p.grupo === '500sur');
    } else if (state.filter === 'haciacentro') {
      list = list.filter((p) => p.grupo === 'haciacentro');
    } else if (state.filter === 'nearest' && state.userLocation) {
      list.sort((a, b) => {
        const da = calcDistanceMeters(
          state.userLocation.lat,
          state.userLocation.lng,
          a.latitudParada || a.latitud,
          a.longitudParada || a.longitud
        ) ?? 999999;
        const db = calcDistanceMeters(
          state.userLocation.lat,
          state.userLocation.lng,
          b.latitudParada || b.latitud,
          b.longitudParada || b.longitud
        ) ?? 999999;
        return da - db;
      });
    }

    return list;
  }

  function renderStops() {
    const list = getFilteredAndSortedStops();
    if (list.length === 0) {
      els.stopsContainer.innerHTML = `<div class="empty-arrival-box">Cargando paradas de OK SUR...</div>`;
      return;
    }

    els.stopsContainer.innerHTML = list
      .map((parada) => {
        const proximo = parada.proximoArribo;
        const siguientes = (parada.arribos || []).slice(1);
        const alarmOn = state.globalAlarm || Boolean(state.stopAlarms[parada.identificador]);

        const userDist = state.userLocation
          ? calcDistanceMeters(
              state.userLocation.lat,
              state.userLocation.lng,
              parada.latitudParada || parada.latitud,
              parada.longitudParada || parada.longitud
            )
          : null;

        let primaryHtml = '';
        if (proximo) {
          const isNow = proximo.esArribando || proximo.minutos === 0;
          const isSoon = !isNow && proximo.minutos !== null && proximo.minutos <= 5;
          const etaClass = isNow ? 'eta-now' : isSoon ? 'eta-soon' : 'eta-normal';

          const clockDisplay = isNow
            ? `<div class="arrival-big-clock mono-time">¡AHORA!</div>`
            : `<div class="arrival-big-clock mono-time">${proximo.horaLlegada || '--:--'} <small>hs</small></div>`;

          const etaDisplay = isNow
            ? `<div class="eta-pill-large ${etaClass}">
                 <span class="eta-num">0 min</span>
                 <span class="eta-unit">Arribando</span>
               </div>`
            : `<div class="eta-pill-large ${etaClass}">
                 <span class="eta-num">${proximo.minutos} min</span>
                 <span class="eta-unit">aprox.</span>
               </div>`;

          // Porcentaje de cercanía visual (de 0 a 100% asumiendo 25 min o 5 km como máximo recorrido)
          let progressPct = 15;
          if (isNow) {
            progressPct = 100;
          } else if (proximo.distanciaMetros !== null) {
            progressPct = Math.max(12, Math.min(96, Math.round((1 - proximo.distanciaMetros / 5500) * 100)));
          } else if (proximo.minutos !== null) {
            progressPct = Math.max(12, Math.min(95, Math.round((1 - proximo.minutos / 30) * 100)));
          }

          const distText = proximo.distanciaTexto
            ? `📍 Colectivo a <strong>${proximo.distanciaTexto}</strong> de la parada`
            : `📡 Seguimiento satelital activo`;

          const extras = [
            proximo.esAdaptado ? '♿ Unidad adaptada' : null,
            proximo.esLleno ? '⚠️ Unidad completa' : null
          ]
            .filter(Boolean)
            .join(' • ');

          primaryHtml = `
            <div class="primary-arrival-box">
              <div class="primary-arrival-main">
                <div class="arrival-clock-col">
                  <span class="arrival-eyebrow">🕒 A QUÉ HORA LLEGA</span>
                  ${clockDisplay}
                  <span class="arrival-sub-label">Bandera: ${proximo.descripcionCartelBandera || parada.sentidoCorto}</span>
                </div>
                <div class="arrival-eta-col">
                  ${etaDisplay}
                </div>
              </div>

              <div class="bus-gps-meta">
                <div class="bus-gps-row">
                  <span>${distText}</span>
                  <span>${extras || 'En recorrido'}</span>
                </div>
                <div class="proximity-track">
                  <div class="proximity-fill" style="width: ${progressPct}%"></div>
                </div>
              </div>
            </div>
          `;
        } else {
          primaryHtml = `
            <div class="empty-arrival-box">
              ${
                parada.error
                  ? `⚠️ ${parada.error}`
                  : 'No hay colectivos OK SUR próximos a esta parada en este momento.'
              }
            </div>
          `;
        }

        const siguientesHtml =
          siguientes.length > 0
            ? `
              <div class="next-buses-list">
                ${siguientes
                  .map(
                    (s) => `
                  <div class="next-bus-item">
                    <div class="next-bus-left">
                      <span>🚌 Siguiente OK SUR</span>
                      ${s.distanciaTexto ? `<small>(a ${s.distanciaTexto})</small>` : ''}
                    </div>
                    <div class="next-bus-right">
                      <span class="next-bus-clock mono-time">${
                        s.horaLlegada ? `~${s.horaLlegada} hs` : ''
                      }</span>
                      <span class="next-bus-mins">${s.tiempoRestanteArribo}</span>
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            `
            : '';

        const isArrivingNow = proximo && (proximo.esArribando || proximo.minutos <= 2);

        return `
          <article class="stop-card group-${parada.grupo} ${isArrivingNow ? 'arriving-now' : ''}" data-stop-id="${parada.identificador}">
            <div class="stop-header">
              <div>
                <div class="stop-badges-row">
                  <span class="direction-badge dir-${parada.grupo}">${parada.sentido}</span>
                  <span class="stop-code-badge">${parada.identificador}</span>
                  ${
                    userDist !== null
                      ? `<span class="user-distance-pill">🚶 A ${formatMeters(userDist)} de vos</span>`
                      : ''
                  }
                </div>
                <h3 class="stop-title">${parada.nombre}</h3>
                <div class="stop-ref-tag">${parada.referenciaUsuario}</div>
              </div>

              <button class="stop-alarm-btn ${alarmOn ? 'active' : ''}" data-action="toggle-alarm" data-stop="${parada.identificador}" title="Avisarme cuando falten 5 min">
                <span>${alarmOn ? '🔔' : '🔕'}</span>
                <span>Avisar</span>
              </button>
            </div>

            ${primaryHtml}
            ${siguientesHtml}

            <div class="stop-card-footer">
              <button class="btn-card-action" data-action="focus-map" data-stop="${parada.identificador}">
                🗺️ Ver en mapa en vivo
              </button>
              <button class="btn-card-action" data-action="refresh-stop" data-stop="${parada.identificador}">
                🔄 Actualizar (${parada.horaActualizacion || '--:--'})
              </button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  // =========================================================================
  // 5. MAPA EN VIVO (LEAFLET + RECORRIDO OK SUR + COLECTIVOS GPS)
  // =========================================================================
  function initMapIfNeeded() {
    if (state.map) return;

    // Centro inicial en San Luis (zona Chacabuco / Sur)
    state.map = L.map('liveMap', {
      zoomControl: true
    }).setView([-33.312, -66.33], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(state.map);

    state.mapLayers.routes = L.layerGroup().addTo(state.map);
    state.mapLayers.stops = L.layerGroup().addTo(state.map);
    state.mapLayers.buses = L.layerGroup().addTo(state.map);
    state.mapLayers.user = L.layerGroup().addTo(state.map);

    drawRoutesOnMap();
    updateMapMarkers();
  }

  async function loadRecorridos() {
    try {
      const res = await fetch('/api/recorrido');
      const data = await res.json();
      if (data.ok && Array.isArray(data.recorridos)) {
        state.recorridos = data.recorridos;
        if (state.map) drawRoutesOnMap();
      }
    } catch (_) {}
  }

  function drawRoutesOnMap() {
    if (!state.map || !state.mapLayers.routes) return;
    state.mapLayers.routes.clearLayers();

    state.recorridos.forEach((rec) => {
      if (!rec.puntos || rec.puntos.length < 2) return;
      const is500Sur = rec.bandera.toUpperCase().includes('500');
      const color = is500Sur ? '#f59e0b' : '#06b6d4';

      L.polyline(rec.puntos, {
        color,
        weight: 4,
        opacity: 0.78
      })
        .bindPopup(`<strong>OK SUR • ${rec.bandera}</strong>`)
        .addTo(state.mapLayers.routes);
    });
  }

  function updateMapMarkers() {
    if (!state.map) return;
    state.mapLayers.stops.clearLayers();
    state.mapLayers.buses.clearLayers();

    let totalBuses = 0;

    state.paradas.forEach((parada) => {
      const sLat = parada.latitudParada || parada.latitud;
      const sLon = parada.longitudParada || parada.longitud;

      if (sLat && sLon) {
        const stopIcon = L.divIcon({
          className: '',
          html: `<div class="custom-stop-marker">🚏 ${parada.nombre}</div>`,
          iconAnchor: [50, 14]
        });

        const proxText = parada.proximoArribo
          ? parada.proximoArribo.esArribando
            ? '🟢 ¡Arribando ahora!'
            : `🕒 Llega ~${parada.proximoArribo.horaLlegada} hs (${parada.proximoArribo.minutos} min)`
          : 'Sin unidades próximas';

        L.marker([sLat, sLon], { icon: stopIcon })
          .bindPopup(
            `<strong>${parada.nombre}</strong><br/>` +
              `<small>${parada.sentido} (${parada.identificador})</small><br/>` +
              `<strong>${proxText}</strong>`
          )
          .addTo(state.mapLayers.stops);
      }

      // Dibujar los colectivos que están en camino a esta parada
      (parada.arribos || []).forEach((arr) => {
        if (arr.latitudNumero && arr.longitudNumero) {
          totalBuses += 1;
          const labelTiempo = arr.esArribando
            ? '¡Arribando!'
            : `${arr.horaLlegada} hs (${arr.minutos}m)`;

          const busIcon = L.divIcon({
            className: '',
            html: `<div class="custom-bus-marker">🚌 OK SUR • ${labelTiempo}</div>`,
            iconAnchor: [65, 14]
          });

          L.marker([arr.latitudNumero, arr.longitudNumero], { icon: busIcon })
            .bindPopup(
              `<strong>🚌 Colectivo OK SUR</strong><br/>` +
                `Hacia: <strong>${parada.nombre}</strong><br/>` +
                `Hora estimada: <strong>${arr.horaLlegada || 'Ahora'} hs</strong> (${arr.tiempoRestanteArribo})<br/>` +
                `${arr.distanciaTexto ? `Distancia a parada: ${arr.distanciaTexto}` : ''}`
            )
            .addTo(state.mapLayers.buses);
        }
      });
    });

    els.mapBusStatusFooter.textContent =
      totalBuses > 0
        ? `📡 Mostrando ${totalBuses} unidad(es) de OK SUR en tiempo real por GPS.`
        : '🚏 Mostrando las 3 paradas de OK SUR. No hay unidades con GPS activo en este instante.';
  }

  function focusStopOnMap(stopCode) {
    switchView('viewMapa');
    initMapIfNeeded();

    const parada = state.paradas.find((p) => p.identificador === stopCode);
    if (!parada || !state.map) return;

    const sLat = parada.latitudParada || parada.latitud;
    const sLon = parada.longitudParada || parada.longitud;
    const bounds = [[sLat, sLon]];

    if (parada.proximoArribo?.latitudNumero && parada.proximoArribo?.longitudNumero) {
      bounds.push([parada.proximoArribo.latitudNumero, parada.proximoArribo.longitudNumero]);
    }

    setTimeout(() => {
      state.map.invalidateSize();
      if (bounds.length > 1) {
        state.map.fitBounds(bounds, { padding: [55, 55], maxZoom: 16 });
      } else {
        state.map.setView([sLat, sLon], 16);
      }
    }, 120);
  }

  // =========================================================================
  // 6. CONSULTA DE DATOS A LA API (/api/arribos)
  // =========================================================================
  async function fetchArribos(force = false) {
    if (state.isFetching) return;
    state.isFetching = true;
    els.fabIcon.classList.add('spinning');
    els.liveStatusText.textContent = 'ACTUALIZANDO...';

    try {
      const url = force ? '/api/arribos?force=1' : '/api/arribos';
      const res = await fetch(url);
      const data = await res.json();

      if (data.ok && Array.isArray(data.paradas)) {
        state.paradas = data.paradas;
        state.countdown = REFRESH_INTERVAL_SEC;
        els.lastSyncText.textContent = `Actualizado ${data.horaServidor || ''}`;
        els.liveStatusText.textContent = 'EN VIVO';

        updateHeroBanner(state.paradas);
        renderStops();
        updateMapMarkers();
        checkAndTriggerAlarms(state.paradas);
      } else {
        els.liveStatusText.textContent = 'REINTENTANDO';
      }
    } catch (err) {
      els.liveStatusText.textContent = 'SIN CONEXIÓN';
      showToast('⚠️ Error de red al consultar Transpuntano');
    } finally {
      state.isFetching = false;
      els.fabIcon.classList.remove('spinning');
    }
  }

  // =========================================================================
  // 7. NAVEGACIÓN ENTRE PESTAÑAS E INTERACCIONES
  // =========================================================================
  function switchView(targetId) {
    document.querySelectorAll('.view-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === targetId);
    });
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.target === targetId);
    });

    if (targetId === 'viewMapa') {
      initMapIfNeeded();
      setTimeout(() => state.map && state.map.invalidateSize(), 100);
    }
  }

  function setupEventListeners() {
    // Bottom navigation tabs
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchView(tab.dataset.target));
    });

    // Botón Header "App Celu"
    els.btnInstallHeader.addEventListener('click', () => {
      if (state.deferredInstallPrompt) {
        triggerNativeInstall();
      } else {
        switchView('viewInstalar');
      }
    });

    // Filtros de paradas
    document.querySelectorAll('.filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const filterVal = chip.dataset.filter;
        if (filterVal === 'nearest' && !state.userLocation) {
          requestUserGps(() => {
            setActiveFilter('nearest');
          });
          return;
        }
        setActiveFilter(filterVal);
      });
    });

    // Delegación de eventos en tarjetas de paradas
    els.stopsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const stopCode = btn.dataset.stop;

      if (action === 'toggle-alarm') {
        requestNotificationPermission();
        state.stopAlarms[stopCode] = !state.stopAlarms[stopCode];
        localStorage.setItem('oksur_stop_alarms', JSON.stringify(state.stopAlarms));
        renderStops();
        showToast(
          state.stopAlarms[stopCode]
            ? `🔔 Alerta activada para parada ${stopCode} (<= 5 min)`
            : `🔕 Alerta desactivada para parada ${stopCode}`
        );
      } else if (action === 'focus-map') {
        focusStopOnMap(stopCode);
      } else if (action === 'refresh-stop') {
        fetchArribos(true);
      }
    });

    // Alarma global
    els.btnGlobalAlarm.addEventListener('click', () => {
      requestNotificationPermission();
      state.globalAlarm = !state.globalAlarm;
      localStorage.setItem('oksur_global_alarm', String(state.globalAlarm));
      updateGlobalAlarmUi();
      renderStops();
      showToast(
        state.globalAlarm
          ? '🔔 Alarma general activada: te avisaremos cuando un OK SUR esté a 5 min o menos'
          : '🔕 Alarma general desactivada'
      );
    });

    // Botones de actualizar
    els.btnRefreshTop.addEventListener('click', () => fetchArribos(true));
    els.fabRefresh.addEventListener('click', () => fetchArribos(true));

    // Controles del mapa
    document.querySelectorAll('.map-stop-pill').forEach((pill) => {
      pill.addEventListener('click', () => focusStopOnMap(pill.dataset.stop));
    });

    document.getElementById('btnCenterAll').addEventListener('click', () => {
      if (!state.map) return;
      state.map.setView([-33.314, -66.326], 13);
    });

    document.getElementById('btnMyLocationMap').addEventListener('click', () => {
      requestUserGps((loc) => {
        if (!state.map) return;
        state.mapLayers.user.clearLayers();
        L.circleMarker([loc.lat, loc.lng], {
          radius: 8,
          fillColor: '#38bdf8',
          color: '#ffffff',
          weight: 3,
          fillOpacity: 1
        })
          .bindPopup('📍 Tu ubicación actual')
          .addTo(state.mapLayers.user)
          .openPopup();
        state.map.setView([loc.lat, loc.lng], 15);
      });
    });

    // Copiar URL LAN
    els.btnCopyLanUrl.addEventListener('click', () => {
      const text = els.lanUrlCode.textContent;
      navigator.clipboard?.writeText(text);
      showToast('📋 Dirección copiada al portapapeles');
    });
  }

  function setActiveFilter(filterVal) {
    state.filter = filterVal;
    document.querySelectorAll('.filter-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.filter === filterVal);
    });
    renderStops();
  }

  function requestUserGps(onSuccess) {
    if (!navigator.geolocation) {
      showToast('⚠️ Tu navegador no soporta geolocalización GPS');
      return;
    }
    showToast('📍 Obteniendo tu ubicación GPS...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.userLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
        renderStops();
        if (onSuccess) onSuccess(state.userLocation);
      },
      () => {
        showToast('⚠️ Activá la ubicación del celular para ordenar por cercanía');
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  }

  // =========================================================================
  // 8. INSTALACIÓN PWA EN ANDROID Y QR DE CONEXIÓN LOCAL
  // =========================================================================
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    els.androidInstallBanner.classList.remove('hidden');
    els.nativeInstallBox.classList.remove('hidden');
  });

  async function triggerNativeInstall() {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    const { outcome } = await state.deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      els.androidInstallBanner.classList.add('hidden');
      els.nativeInstallBox.classList.add('hidden');
      showToast('🎉 ¡Aplicación OK SUR instalada en tu Android!');
    }
    state.deferredInstallPrompt = null;
  }

  els.btnInstallDirect.addEventListener('click', triggerNativeInstall);
  els.btnTriggerNativeInstall.addEventListener('click', triggerNativeInstall);
  els.btnDismissInstall.addEventListener('click', () => {
    els.androidInstallBanner.classList.add('hidden');
  });

  async function loadServerNetworkInfo() {
    try {
      const res = await fetch('/api/info');
      const info = await res.json();
      const targetUrl =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
          ? info.lanUrl
          : window.location.origin;

      els.lanUrlCode.textContent = targetUrl;
      const qrApi = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
        targetUrl
      )}`;
      els.qrContainer.innerHTML = `<img src="${qrApi}" alt="Código QR para abrir en el celular" loading="lazy" />`;
    } catch (_) {
      els.lanUrlCode.textContent = window.location.origin;
    }
  }

  // Registrar Service Worker para que Android permita instalarla como App nativa
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // =========================================================================
  // INICIALIZACIÓN
  // =========================================================================
  updateGlobalAlarmUi();
  updateClock();
  setupEventListeners();
  renderStops();
  fetchArribos(false);
  loadRecorridos();
  loadServerNetworkInfo();
  setInterval(tickCountdown, 1000);
})();
