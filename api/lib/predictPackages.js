function buildPredictionPayload(prediction, {
  debug = false,
  sanitizeDiagnostics,
} = {}) {
  const diagnostics = typeof sanitizeDiagnostics === 'function'
    ? sanitizeDiagnostics(prediction?.diagnostics || {}, debug)
    : (prediction?.diagnostics || {});

  return {
    prediction: {
      totalPallets: prediction?.totalPallets || 0,
      totalWeight: prediction?.totalWeight || 0,
      breakdown: prediction?.breakdown || [],
      packages: prediction?.packages || [],
      summary: prediction?.summary || {
        totalPackages: prediction?.totalPallets || 0,
        totalWeight: prediction?.totalWeight || 0,
        confidence: 'low',
        needsReview: true,
      },
    },
    predicted_pallets: prediction?.totalPallets || 0,
    predicted_weight: prediction?.totalWeight || 0,
    predicted_breakdown: prediction?.breakdown || [],
    predicted_packages: prediction?.packages || [],
    diagnostics,
  };
}

function predictPackages(items, {
  predict,
  debug = false,
  sanitizeDiagnostics,
} = {}) {
  if (typeof predict !== 'function') {
    throw new Error('predict function is required');
  }
  const prediction = predict(Array.isArray(items) ? items : []);
  return {
    ...buildPredictionPayload(prediction, { debug, sanitizeDiagnostics }),
    rawPrediction: prediction,
  };
}

module.exports = {
  buildPredictionPayload,
  predictPackages,
};
