const recorridosRawData = require('../data/recorridos-358.json');

const BASE_URL = 'https://cuandollega.smartmovepro.net/transpuntano';
const RECORRIDOS_URL = `${BASE_URL}/recorridos`;
const LINEA_OK_CODIGO = '358';

// Las 3 paradas principales de OK SUR solicitadas por el usuario
const PARADAS_OK_SUR = [
  {
    id: 'chacabuco-pedernera-500sur',
    identificador: 'SL10094',
    codigoParada: '49098',
    codigoLinea: '358',
    codigoCalle: 18672,
    codigoInterseccion: 20024,
    nombre: 'Chacabuco y Pedernera',
    calle: 'Chacabuco',
    interseccion: 'Pedernera',
    sentido: 'Hacia Bº 500 Viv. Sur',
    sentidoCorto: '500 SUR',
    grupo: '500sur',
    referenciaUsuario: 'chacabuco,pedernera,500sur',
    latitud: -33.300135,
    longitud: -66.339954,
    color: '#f59e0b'
  },
  {
    id: 'chacabuco-9dejulio-500sur',
    identificador: 'SL10096',
    codigoParada: '49100',
    codigoLinea: '358',
    codigoCalle: 18672,
    codigoInterseccion: 18598,
    nombre: 'Chacabuco y 9 de Julio',
    calle: 'Chacabuco',
    interseccion: '9 de Julio',
    sentido: 'Hacia Bº 500 Viv. Sur',
    sentidoCorto: '500 SUR',
    grupo: '500sur',
    referenciaUsuario: 'chacabuco,9dejulio,hacia500sur',
    latitud: -33.306826,
    longitud: -66.337851,
    color: '#f97316'
  },
  {
    id: 'mirador-parada2-centro',
    identificador: 'SL10052',
    codigoParada: '38221',
    codigoLinea: '358',
    codigoCalle: 21312,
    codigoInterseccion: 19400,
    nombre: 'Mirador del Portezuelo • Parada 2',
    calle: 'Bº Mirador del Portezuelo',
    interseccion: 'Parada 2',
    sentido: 'Hacia el Centro',
    sentidoCorto: 'HACIA CENTRO',
    grupo: 'haciacentro',
    referenciaUsuario: 'miradordelportezuelo,parada2,haciacentro',
    latitud: -33.328082,
    longitud: -66.310193,
    color: '#06b6d4'
  }
];

let csrfSession = {
  token: null,
  cookies: null,
  createdAt: 0
};

const stopCache = new Map();
const CACHE_TTL_MS = 22 * 1000;
const MIN_FORCE_TTL_MS = 10 * 1000;
const SESSION_TTL_MS = 15 * 60 * 1000;

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const nLat1 = parseFloat(lat1);
  const nLon1 = parseFloat(lon1);
  const nLat2 = parseFloat(lat2);
  const nLon2 = parseFloat(lon2);

  if ([nLat1, nLon1, nLat2, nLon2].some((v) => Number.isNaN(v) || v === 0)) {
    return null;
  }

  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(nLat2 - nLat1);
  const dLon = toRad(nLon2 - nLon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(nLat1)) *
      Math.cos(toRad(nLat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function formatearDistancia(metros) {
  if (metros === null || metros === undefined) return null;
  if (metros < 1000) return `${metros} m`;
  return `${(metros / 1000).toFixed(1)} km`;
}

function enriquecerArribo(arribo, stopLat, stopLon, nowMs = Date.now()) {
  const raw = (arribo.tiempoRestanteArribo || '').trim();
  const lower = raw.toLowerCase();

  let minutos = null;
  let esArribando = false;

  if (lower.includes('arribando') || lower === '0' || lower.includes('ahora')) {
    minutos = 0;
    esArribando = true;
  } else {
    const match = raw.match(/(\d+)/);
    if (match) {
      minutos = parseInt(match[1], 10);
    }
  }

  let horaLlegada = null;
  let timestampLlegada = null;

  if (minutos !== null) {
    timestampLlegada = nowMs + minutos * 60 * 1000;
    const fechaLlegada = new Date(timestampLlegada);
    horaLlegada = fechaLlegada.toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/San_Luis',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  const refLat = arribo.latitudParada || stopLat;
  const refLon = arribo.longitudParada || stopLon;
  const distanciaMetros = calcularDistanciaMetros(
    arribo.latitud,
    arribo.longitud,
    refLat,
    refLon
  );

  return {
    ...arribo,
    minutos,
    esArribando,
    horaLlegada,
    timestampLlegada,
    distanciaMetros,
    distanciaTexto: formatearDistancia(distanciaMetros),
    latitudNumero: arribo.latitud ? parseFloat(arribo.latitud) : null,
    longitudNumero: arribo.longitud ? parseFloat(arribo.longitud) : null
  };
}

let sessionPromise = null;

async function obtenerSesionCsrf(forceRefresh = false) {
  const now = Date.now();
  if (
    !forceRefresh &&
    csrfSession.token &&
    csrfSession.cookies &&
    now - csrfSession.createdAt < SESSION_TTL_MS
  ) {
    return csrfSession;
  }

  if (sessionPromise && !forceRefresh) {
    return sessionPromise;
  }

  sessionPromise = (async () => {
    try {
      let resp = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        resp = await fetch(RECORRIDOS_URL, {
          method: 'GET',
          headers: {
            Referer: BASE_URL
          },
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4500) : undefined
        });
        if (resp.ok) break;
        await new Promise((r) => setTimeout(r, 250));
      }

      if (!resp || !resp.ok) {
        throw new Error(`Error al conectar con Transpuntano (HTTP ${resp ? resp.status : 'Red'})`);
      }

      const setCookies =
        typeof resp.headers.getSetCookie === 'function'
          ? resp.headers.getSetCookie()
          : [resp.headers.get('set-cookie')].filter(Boolean);

      const cookies = setCookies.map((c) => c.split(';')[0]).join('; ');
      const html = await resp.text();
      const match = html.match(/name="CSRF-TOKEN-CL-FORM"[^>]*value="([^"]+)"/);

      if (!match || !match[1]) {
        throw new Error('No se encontró el token CSRF en Transpuntano');
      }

      csrfSession = {
        token: match[1],
        cookies,
        createdAt: Date.now()
      };

      return csrfSession;
    } finally {
      sessionPromise = null;
    }
  })();

  return sessionPromise;
}

async function consultarArribosParada(identificadorParada, stopMeta = {}, options = {}) {
  const key = `${identificadorParada}:${LINEA_OK_CODIGO}`;
  const now = Date.now();
  const cached = stopCache.get(key);

  const effectiveTtl = options.force ? MIN_FORCE_TTL_MS : CACHE_TTL_MS;
  if (cached && now - cached.timestamp < effectiveTtl) {
    return {
      ...cached.data,
      fromCache: true,
      cacheAgeMs: now - cached.timestamp
    };
  }

  let session = await obtenerSesionCsrf(false);

  const doPost = async (sess) => {
    return fetch(`${RECORRIDOS_URL}?handler=Arribos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        RequestVerificationToken: sess.token,
        Referer: RECORRIDOS_URL,
        Cookie: sess.cookies
      },
      body: JSON.stringify({
        IdentificadorParada: identificadorParada,
        CodigoLinea: LINEA_OK_CODIGO
      }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4500) : undefined
    });
  };

  let resp = await doPost(session);

  if (resp.status === 403 && now - session.createdAt > 60 * 1000) {
    session = await obtenerSesionCsrf(true);
    resp = await doPost(session);
  }

  if (resp.status === 429) {
    const msg = await resp.text();
    if (cached) {
      return {
        ...cached.data,
        fromCache: true,
        warning: msg || 'Mostrando último dato disponible.'
      };
    }
    throw new Error(msg || 'El servidor de Transpuntano solicita esperar unos segundos.');
  }

  // HTTP 400 o 404 en ?handler=Arribos indica que no hay unidades próximas en este momento
  if (resp.status === 400 || resp.status === 404) {
    const emptyResult = {
      identificador: identificadorParada,
      actualizadoEn: now,
      horaActualizacion: new Date(now).toLocaleTimeString('es-AR', {
        timeZone: 'America/Argentina/San_Luis',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }),
      latitudParada: stopMeta.latitud,
      longitudParada: stopMeta.longitud,
      arribos: [],
      proximoArribo: null
    };
    stopCache.set(key, { timestamp: now, data: emptyResult });
    return emptyResult;
  }

  if (!resp.ok) {
    if (cached) {
      return {
        ...cached.data,
        fromCache: true
      };
    }
    throw new Error(`Servidor de Transpuntano ocupado (HTTP ${resp.status})`);
  }

  const rawData = await resp.json();
  const rawArribos = Array.isArray(rawData?.arribos) ? rawData.arribos : [];

  const arribosLineaOk = rawArribos
    .filter((a) => String(a.codigoLinea) === LINEA_OK_CODIGO)
    .map((a) => enriquecerArribo(a, stopMeta.latitud, stopMeta.longitud, now))
    .sort((a, b) => {
      const ma = a.minutos ?? 999;
      const mb = b.minutos ?? 999;
      return ma - mb;
    });

  const latParada =
    arribosLineaOk.find((a) => a.latitudParada)?.latitudParada || stopMeta.latitud || null;
  const lonParada =
    arribosLineaOk.find((a) => a.longitudParada)?.longitudParada || stopMeta.longitud || null;

  const result = {
    identificador: identificadorParada,
    actualizadoEn: now,
    horaActualizacion: new Date(now).toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/San_Luis',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }),
    latitudParada: latParada ? parseFloat(latParada) : stopMeta.latitud,
    longitudParada: lonParada ? parseFloat(lonParada) : stopMeta.longitud,
    arribos: arribosLineaOk,
    proximoArribo: arribosLineaOk[0] || null
  };

  stopCache.set(key, {
    timestamp: now,
    data: result
  });

  return result;
}

async function obtenerEstadoOkSur(options = {}) {
  const nowStr = new Date().toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/San_Luis',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // Aseguramos sesión CSRF una sola vez antes de consultar las 3 paradas
  try {
    await obtenerSesionCsrf(false);
  } catch (sessionErr) {
    return {
      ok: true,
      linea: {
        codigo: LINEA_OK_CODIGO,
        nombre: 'OK SUR',
        descripcionOficial: 'LINEA OK',
        empresa: 'Transpuntano S.A.P.E.M. (San Luis)'
      },
      servidorTimestamp: Date.now(),
      horaServidor: nowStr,
      paradas: PARADAS_OK_SUR.map((parada) => ({
        ...parada,
        actualizadoEn: Date.now(),
        horaActualizacion: nowStr,
        latitudParada: parada.latitud,
        longitudParada: parada.longitud,
        arribos: [],
        proximoArribo: null,
        error: sessionErr.message || 'Reintentando conexión con Transpuntano...'
      }))
    };
  }

  const resultados = await Promise.all(
    PARADAS_OK_SUR.map(async (parada, idx) => {
      if (idx > 0) {
        await new Promise((r) => setTimeout(r, idx * 120));
      }
      try {
        const estado = await consultarArribosParada(parada.identificador, parada, options);
        return {
          ...parada,
          ...estado,
          error: null
        };
      } catch (err) {
        return {
          ...parada,
          actualizadoEn: Date.now(),
          horaActualizacion: nowStr,
          latitudParada: parada.latitud,
          longitudParada: parada.longitud,
          arribos: [],
          proximoArribo: null,
          error: err.message || 'No se pudo consultar la parada'
        };
      }
    })
  );

  return {
    ok: true,
    linea: {
      codigo: LINEA_OK_CODIGO,
      nombre: 'OK SUR',
      descripcionOficial: 'LINEA OK',
      empresa: 'Transpuntano S.A.P.E.M. (San Luis)'
    },
    servidorTimestamp: Date.now(),
    horaServidor: nowStr,
    paradas: resultados
  };
}

function obtenerRecorridosOkSur() {
  const raw = Array.isArray(recorridosRawData) ? recorridosRawData : [];

  const ramalesSur = raw
    .map((r) => {
      const partes = (r.descripcion || '').split(';');
      const id = partes[0];
      const bandera = partes[1] || r.descripcion;
      const cartel = partes[2] || bandera;
      return {
        id,
        bandera,
        cartel,
        puntos: (r.puntos || []).map((p) => [parseFloat(p.latitud), parseFloat(p.longitud)]),
        paradas: (r.paradas || []).map((p) => ({
          codigo: p.codigo,
          identificador: p.identificador,
          descripcion: p.descripcion,
          bandera: p.abreviaturaBandera,
          latitud: parseFloat(p.latitudParada),
          longitud: parseFloat(p.longitudParada)
        }))
      };
    })
    .filter((r) => ['60', '82', '83', '84'].includes(String(r.id)));

  return {
    ok: true,
    codigoLinea: LINEA_OK_CODIGO,
    paradasDestacadas: PARADAS_OK_SUR,
    recorridos: ramalesSur
  };
}

module.exports = {
  PARADAS_OK_SUR,
  LINEA_OK_CODIGO,
  consultarArribosParada,
  obtenerEstadoOkSur,
  obtenerRecorridosOkSur
};
