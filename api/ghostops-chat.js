// api/ghostops-chat.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const { messages } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages manquants" });
    }

    // On limite l'historique pour éviter les prompts trop longs
    const recentMessages = messages.slice(-10);

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini", // adaptez si besoin
      temperature: 0.4,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            "Tu es GhostOps IA, une cellule tactique d’analyse RH, de gouvernance et de jeux de pouvoir internes. " +
            "Tu réponds en français, avec un ton sobre, précis et professionnel. " +
            "Tu aides les dirigeants, boards et DRH à clarifier leurs situations (crises RH, lignes hiérarchiques fragilisées, " +
            "fonction juridique ou RH en risque de gouvernance, loyautés invisibles, etc.). " +
            "Tu ne donnes pas de conseils juridiques formels, mais des grilles de lecture, des questions à se poser " +
            "et des pistes d’angle d’analyse. Si une question sort clairement du périmètre GhostOps, tu l’indiques.",
        },
        ...recentMessages,
      ],
    });

    const reply = completion.choices[0]?.message || {
      role: "assistant",
      content:
        "Je rencontre une difficulté technique. Vous pouvez utiliser la page contact pour un échange direct.",
    };

    return res.status(200).json({ reply });
  } catch (error) {
    console.error("Erreur GhostOps chatbot:", error);
    return res
      .status(500)
      .json({ error: "Erreur interne lors de la génération de la réponse." });
  }
}
