import Anthropic from "@anthropic-ai/sdk";

const PACKING_RULES = `
## PACKING CONSTRAINTS
- Max pallet height: 96 inches (prefer 84" for safety)
- Max pallet weight: 2,500 lbs
- Standard pallet bases: 48x40 (most common), 80x32 (long items), 86x40 (DD/stretch)
- Empty pallet weight: 50 lbs

## STACKING RULES
- Heavy items on bottom, light on top
- Same product family can stack together
- Varsity + VR2 = OK (both bike racks)
- HR101 + HR201 = OK (both hoop runners)

## CANNOT MIX
- Lockers with bike racks (different footprints)
- Double Dockers with small racks (DD trays fragile)
- Stretch Racks with anything (ship flat, separate)

## PRODUCT-SPECIFIC
- Varsity (DV215): 34x14x11" box @ 49 lbs (2-pack)
- VR2: 43x25x13" box @ 51 lbs (2-pack)  
- HR101: 34x29x7" box @ 23 lbs (flat packed)
- DD4: Ships loose in 86x40x23" crates, 8 trays per crate
- Lockers (MBV/VISI): 81x26x13" + 82x32x21" boxes, ~414 lbs per locker
`;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "No items provided" });
  }

  // Format items for prompt
  const itemsText = items
    .map(
      (item) =>
        `- ${item.quantity}x ${item.name || item.sku}: ${item.length || 48}"L x ${item.width || 40}"W x ${item.height || 12}"H, ${item.weight || 50} lbs each`
    )
    .join("\n");

  const prompt = `You are a warehouse packing expert. Create an optimal pallet packing plan for this order.

## ORDER ITEMS
${itemsText}

${PACKING_RULES}

## OUTPUT FORMAT
Return ONLY valid JSON:
{
  "summary": "Brief description",
  "total_pallets": 2,
  "total_weight": 1500,
  "pallets": [
    {
      "pallet_number": 1,
      "base_size": "48x40",
      "total_height": 72,
      "total_weight": 800,
      "layers": [
        {
          "layer_number": 1,
          "height_from_base": 0,
          "layer_height": 24,
          "products": [
            {"sku": "DV215", "quantity": 20, "arrangement": "4x5 grid", "color": "#4CAF50"}
          ]
        }
      ],
      "notes": "Heavy items on bottom"
    }
  ],
  "instructions": ["Strap pallets", "Fragile items on top"]
}

Assign a distinct color hex code to each product type for visualization.`;

  try {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = message.content[0].text;

    // Extract JSON
    let jsonStr = responseText;
    if (responseText.includes("```json")) {
      jsonStr = responseText.split("```json")[1].split("```")[0];
    } else if (responseText.includes("```")) {
      jsonStr = responseText.split("```")[1].split("```")[0];
    }

    const plan = JSON.parse(jsonStr.trim());

    return res.status(200).json({
      success: true,
      plan,
    });
  } catch (error) {
    console.error("Optimization error:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
