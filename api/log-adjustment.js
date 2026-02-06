/**
 * API endpoint to log warehouse packing adjustments
 * Used by PackingPlan.jsx when warehouse clicks "Adjust" on a pallet
 * 
 * Stores adjustments for learning loop - helps improve packing rules over time
 */

// In-memory storage for serverless (will persist to file locally)
let adjustments = [];

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // GET - retrieve adjustments
  if (req.method === "GET") {
    return res.status(200).json({
      success: true,
      count: adjustments.length,
      adjustments: adjustments.slice(-100) // Last 100
    });
  }

  // POST - log new adjustment
  if (req.method === "POST") {
    try {
      const { palletId, palletType, layers, reason, suggestedChange, orderSnapshot, timestamp } = req.body;

      if (!palletId || !layers) {
        return res.status(400).json({ 
          success: false, 
          error: "Missing required fields: palletId, layers" 
        });
      }

      const adjustment = {
        id: `adj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        palletId,
        palletType: palletType || 'unknown',
        layers,
        reason: reason || '',
        suggestedChange: suggestedChange || '',
        orderSnapshot: orderSnapshot || null,
        timestamp: timestamp || new Date().toISOString(),
        source: 'warehouse-ui'
      };

      adjustments.push(adjustment);

      // Keep only last 1000 adjustments in memory
      if (adjustments.length > 1000) {
        adjustments = adjustments.slice(-1000);
      }

      console.log(`[log-adjustment] Logged adjustment ${adjustment.id} for pallet ${palletId}`);

      return res.status(200).json({
        success: true,
        adjustmentId: adjustment.id,
        message: 'Adjustment logged successfully'
      });

    } catch (error) {
      console.error('[log-adjustment] Error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
