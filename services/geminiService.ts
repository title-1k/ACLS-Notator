
import { GoogleGenAI } from "@google/genai";
import { ACLSEvent } from "../types";

export const analyzeArrest = async (events: ACLSEvent[]) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const eventLogString = events
    .map(e => `[${e.wallTime}] ${e.type}${e.details ? `: ${e.details}` : ''}`)
    .join('\n');

  const prompt = `
    Analyze the following ACLS Cardiac Arrest log.
    Provide a professional medical summary including:
    1. Timeline of key interventions (Epi intervals, Shocks).
    2. Adherence to ACLS guidelines (e.g., were Epinephrine doses ~3-5 mins apart? Were rhythm checks every 2 mins?).
    3. Recommendations for the debriefing.
    
    Arrest Log:
    ${eventLogString}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 4000 }
      }
    });
    return response.text;
  } catch (error) {
    console.error("AI Analysis failed:", error);
    return "Failed to generate AI analysis. Please check your connection.";
  }
};
