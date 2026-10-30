export interface PhrasePrompt {
  phrase: string
  category: "Funny" | "Movie & Pop Culture" | "Tongue Twisters" | "Short & Sweet" | "Hard"
}

export const PHRASE_PROMPTS: PhrasePrompt[] = [
  // Short & Sweet
  { phrase: "Banana split", category: "Short & Sweet" },
  { phrase: "Peanut butter", category: "Short & Sweet" },
  { phrase: "Abracadabra", category: "Short & Sweet" },
  { phrase: "Disco dancing", category: "Short & Sweet" },
  { phrase: "Hocus pocus", category: "Short & Sweet" },
  { phrase: "Super duper", category: "Short & Sweet" },
  { phrase: "Chocolate milk", category: "Short & Sweet" },
  { phrase: "Pineapple pizza", category: "Short & Sweet" },
  { phrase: "Wobbly jelly", category: "Short & Sweet" },
  { phrase: "Bubble gum", category: "Short & Sweet" },

  // Funny
  { phrase: "Sneaky little goblin", category: "Funny" },
  { phrase: "Why are you running", category: "Funny" },
  { phrase: "Dancing potato", category: "Funny" },
  { phrase: "Tickle my pickle", category: "Funny" },
  { phrase: "I lost my socks", category: "Funny" },
  { phrase: "Penguins wearing hats", category: "Funny" },
  { phrase: "Fluffy pancake party", category: "Funny" },
  { phrase: "Grandma stole my skateboard", category: "Funny" },
  { phrase: "Spaghetti in my pocket", category: "Funny" },
  { phrase: "Captain Chicken Nugget", category: "Funny" },
  { phrase: "Don't touch my cheese", category: "Funny" },

  // Movie & Pop Culture
  { phrase: "May the Force be with you", category: "Movie & Pop Culture" },
  { phrase: "I'll be back", category: "Movie & Pop Culture" },
  { phrase: "To infinity and beyond", category: "Movie & Pop Culture" },
  { phrase: "You shall not pass", category: "Movie & Pop Culture" },
  { phrase: "Here's looking at you kid", category: "Movie & Pop Culture" },
  { phrase: "Just keep swimming", category: "Movie & Pop Culture" },
  { phrase: "Why so serious", category: "Movie & Pop Culture" },
  { phrase: "Houston we have a problem", category: "Movie & Pop Culture" },

  // Tongue Twisters
  { phrase: "Red lorry yellow lorry", category: "Tongue Twisters" },
  { phrase: "She sells seashells", category: "Tongue Twisters" },
  { phrase: "Unique New York", category: "Tongue Twisters" },
  { phrase: "Peter Piper picked a pepper", category: "Tongue Twisters" },
  { phrase: "Fuzzy Wuzzy was a bear", category: "Tongue Twisters" },
  { phrase: "How much wood would a woodchuck chuck", category: "Tongue Twisters" },
  { phrase: "Six slippery snails", category: "Tongue Twisters" },

  // Hard
  { phrase: "Supercalifragilisticexpialidocious", category: "Hard" },
  { phrase: "Extraordinary circumstances", category: "Hard" },
  { phrase: "Peculiar psychological phenomena", category: "Hard" },
  { phrase: "Hypothetical situation", category: "Hard" },
  { phrase: "Incomprehensible babbling", category: "Hard" },
]

export function getRandomPhrase(currentPhrase?: string): PhrasePrompt {
  const filtered = currentPhrase
    ? PHRASE_PROMPTS.filter((p) => p.phrase !== currentPhrase)
    : PHRASE_PROMPTS
  const index = Math.floor(Math.random() * filtered.length)
  return filtered[index]
}

