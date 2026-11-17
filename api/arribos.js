const { obtenerEstadoOkSur, consultarArribosParada, PARADAS_OK_SUR } = require('../lib/transpuntano');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const paradaQuery = urlObj.searchParams.get('parada');
    const force = urlObj.searchParams.get('force') === '1';

    if (paradaQuery) {
      const meta = PARADAS_OK_SUR.find(
        (p) => p.identificador.toUpperCase() === paradaQuery.toUpperCase() || p.id === paradaQuery
      ) || { identificador: paradaQuery.toUpperCase() };

      const resultado = await consultarArribosParada(meta.identificador, meta, { force });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok: true, parada: { ...meta, ...resultado } }));
    }

    const data = await obtenerEstadoOkSur({ force });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(data));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(
      JSON.stringify({
        ok: false,
        error: err.message || 'Error interno al consultar Transpuntano'
      })
    );
  }
};
