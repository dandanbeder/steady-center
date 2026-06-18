// Curated, vetted short quotes. Calm, grounding, focus-oriented.
// Prefer historical / public-domain authors to avoid copyright and misattribution.
// Keep each line short. One is selected deterministically by day-of-year.

export type DailyQuote = { quote: string; author: string };

export const DAILY_QUOTES: DailyQuote[] = [
  { quote: "He who has a why to live for can bear almost any how.", author: "Friedrich Nietzsche" },
  { quote: "The mind is everything. What you think you become.", author: "Buddha" },
  { quote: "We suffer more often in imagination than in reality.", author: "Seneca" },
  { quote: "Very little is needed to make a happy life; it is all within yourself, in your way of thinking.", author: "Marcus Aurelius" },
  { quote: "It is not the man who has too little, but the man who craves more, that is poor.", author: "Seneca" },
  { quote: "Waste no more time arguing what a good man should be. Be one.", author: "Marcus Aurelius" },
  { quote: "You have power over your mind — not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { quote: "The journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
  { quote: "Nature does not hurry, yet everything is accomplished.", author: "Lao Tzu" },
  { quote: "Knowing yourself is the beginning of all wisdom.", author: "Aristotle" },
  { quote: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Will Durant" },
  { quote: "The unexamined life is not worth living.", author: "Socrates" },
  { quote: "He who is contented is rich.", author: "Lao Tzu" },
  { quote: "Patience is bitter, but its fruit is sweet.", author: "Aristotle" },
  { quote: "First say to yourself what you would be; then do what you have to do.", author: "Epictetus" },
  { quote: "No man is free who is not master of himself.", author: "Epictetus" },
  { quote: "Wherever you go, go with all your heart.", author: "Confucius" },
  { quote: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { quote: "Our life is what our thoughts make it.", author: "Marcus Aurelius" },
  { quote: "Begin at once to live, and count each separate day as a separate life.", author: "Seneca" },
  { quote: "If you are distressed by anything external, the pain is not due to the thing itself, but to your estimate of it.", author: "Marcus Aurelius" },
  { quote: "The best revenge is to be unlike him who performed the injury.", author: "Marcus Aurelius" },
  { quote: "Luck is what happens when preparation meets opportunity.", author: "Seneca" },
  { quote: "While we are postponing, life speeds by.", author: "Seneca" },
  { quote: "Difficulties strengthen the mind, as labor does the body.", author: "Seneca" },
  { quote: "He who lives in harmony with himself lives in harmony with the universe.", author: "Marcus Aurelius" },
  { quote: "Silence is a source of great strength.", author: "Lao Tzu" },
  { quote: "Do every act of your life as though it were the very last act of your life.", author: "Marcus Aurelius" },
  { quote: "A ship is safe in harbor, but that's not what ships are for.", author: "John A. Shedd" },
  { quote: "Whatever you can do, or dream you can, begin it. Boldness has genius, power and magic in it.", author: "Johann Wolfgang von Goethe" },
  { quote: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" },
  { quote: "Do not go where the path may lead, go instead where there is no path and leave a trail.", author: "Ralph Waldo Emerson" },
  { quote: "That which does not kill us makes us stronger.", author: "Friedrich Nietzsche" },
  { quote: "Action is the foundational key to all success.", author: "Pablo Picasso" },
  { quote: "Well done is better than well said.", author: "Benjamin Franklin" },
  { quote: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
  { quote: "By failing to prepare, you are preparing to fail.", author: "Benjamin Franklin" },
  { quote: "The two most powerful warriors are patience and time.", author: "Leo Tolstoy" },
  { quote: "Everyone thinks of changing the world, but no one thinks of changing himself.", author: "Leo Tolstoy" },
  { quote: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { quote: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
  { quote: "He who knows others is wise; he who knows himself is enlightened.", author: "Lao Tzu" },
  { quote: "Quality is not an act, it is a habit.", author: "Aristotle" },
  { quote: "There is nothing either good or bad, but thinking makes it so.", author: "William Shakespeare" },
  { quote: "This above all: to thine own self be true.", author: "William Shakespeare" },
  { quote: "Our greatest glory is not in never falling, but in rising every time we fall.", author: "Confucius" },
  { quote: "Life is really simple, but we insist on making it complicated.", author: "Confucius" },
  { quote: "Adopt the pace of nature: her secret is patience.", author: "Ralph Waldo Emerson" },
  { quote: "To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment.", author: "Ralph Waldo Emerson" },
  { quote: "What we think, we become.", author: "Buddha" },
  { quote: "Peace comes from within. Do not seek it without.", author: "Buddha" },
  { quote: "The best way out is always through.", author: "Robert Frost" },
  { quote: "Energy and persistence conquer all things.", author: "Benjamin Franklin" },
  { quote: "He who opens a school door, closes a prison.", author: "Victor Hugo" },
  { quote: "Even the darkest night will end and the sun will rise.", author: "Victor Hugo" },
  { quote: "Do not anticipate trouble, or worry about what may never happen. Keep in the sunlight.", author: "Benjamin Franklin" },
  { quote: "Hope is the thing with feathers that perches in the soul.", author: "Emily Dickinson" },
  { quote: "Not all those who wander are lost.", author: "J. R. R. Tolkien" },
  { quote: "The only journey is the one within.", author: "Rainer Maria Rilke" },
  { quote: "Be patient toward all that is unsolved in your heart.", author: "Rainer Maria Rilke" },
  { quote: "How we spend our days is, of course, how we spend our lives.", author: "Annie Dillard" },
  { quote: "Life can only be understood backwards; but it must be lived forwards.", author: "Søren Kierkegaard" },
  { quote: "Tension is who you think you should be. Relaxation is who you are.", author: "Chinese Proverb" },
  { quote: "Fall seven times, stand up eight.", author: "Japanese Proverb" },
  { quote: "A journey is best measured in friends, rather than miles.", author: "Tim Cahill" },
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
