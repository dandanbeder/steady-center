// Curated, vetted short quotes. Calm, grounding, focus-oriented.
// Prefer historical / public-domain authors to avoid copyright and misattribution.
// Keep each line short. One is selected deterministically by day-of-year.

export type DailyQuote = { quote: string; author: string };

export const DAILY_QUOTES: DailyQuote[] = [
  { quote: "You have power over your mind, not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { quote: "The happiness of your life depends upon the quality of your thoughts.", author: "Marcus Aurelius" },
  { quote: "Very little is needed to make a happy life; it is all within yourself, in your way of thinking.", author: "Marcus Aurelius" },
  { quote: "Confine yourself to the present.", author: "Marcus Aurelius" },
  { quote: "Waste no more time arguing about what a good person should be. Be one.", author: "Marcus Aurelius" },
  { quote: "We suffer more often in imagination than in reality.", author: "Seneca" },
  { quote: "It is not that we have a short time to live, but that we waste much of it.", author: "Seneca" },
  { quote: "While we are postponing, life speeds by.", author: "Seneca" },
  { quote: "Begin at once to live, and count each day as a separate life.", author: "Seneca" },
  { quote: "Difficulties strengthen the mind, as labor does the body.", author: "Seneca" },
  { quote: "First say to yourself what you would be; and then do what you have to do.", author: "Epictetus" },
  { quote: "It is not what happens to you, but how you react to it that matters.", author: "Epictetus" },
  { quote: "No one is free who is not master of himself.", author: "Epictetus" },
  { quote: "The journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
  { quote: "Nature does not hurry, yet everything is accomplished.", author: "Lao Tzu" },
  { quote: "When I let go of what I am, I become what I might be.", author: "Lao Tzu" },
  { quote: "Knowing others is wisdom; knowing yourself is enlightenment.", author: "Lao Tzu" },
  { quote: "He who is contented is rich.", author: "Lao Tzu" },
  { quote: "Well begun is half done.", author: "Aristotle" },
  { quote: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { quote: "The man who moves a mountain begins by carrying away small stones.", author: "Confucius" },
  { quote: "Finish each day and be done with it. You have done what you could.", author: "Ralph Waldo Emerson" },
  { quote: "Write it on your heart that every day is the best day in the year.", author: "Ralph Waldo Emerson" },
  { quote: "It is not enough to be busy; the question is what we are busy about.", author: "Henry David Thoreau" },
  { quote: "If one advances confidently in the direction of his dreams, he will meet with success unexpected.", author: "Henry David Thoreau" },
  { quote: "Nothing is so fatiguing as the eternal hanging on of an uncompleted task.", author: "William James" },
  { quote: "Knowing is not enough; we must apply. Willing is not enough; we must do.", author: "Johann Wolfgang von Goethe" },
  { quote: "No man ever steps in the same river twice.", author: "Heraclitus" },
  { quote: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche" },
  { quote: "Yesterday I was clever, so I wanted to change the world. Today I am wise, so I am changing myself.", author: "Rumi" },
];

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const now = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((now - start) / 86_400_000);
}

export function getQuoteOfTheDay(date: Date = new Date()): DailyQuote {
  const idx = dayOfYear(date) % DAILY_QUOTES.length;
  return DAILY_QUOTES[idx];
}
