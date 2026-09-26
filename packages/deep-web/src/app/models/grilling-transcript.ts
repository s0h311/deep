/** The Grilling Transcript Artifact: the user's question, then every Grilling question asked so far. */
export type GrillingTranscript = { question: string; turns: GrillingTurn[] }

/** One Grilling question with its recommended answer, and the user's answer once given. */
export type GrillingTurn = { question: string; recommendedAnswer: string; answer?: string }
