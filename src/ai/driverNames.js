// Fun AI driver names: an alliterative adjective + first name, e.g.
// "Lead-foot Luke", "Squealin' Sam". Names are drawn once per championship and
// persisted with the roster so a driver keeps their name across the series.
//
// The pool is grouped by first letter so each pick alliterates; the generator
// cycles through distinct letters first for variety, then fills any remainder
// with unique combos.

const POOL = {
  A: { adjectives: ['Angry', 'Ace', 'Amped', 'Agile'], names: ['Andy', 'Al', 'Archie', 'Axel'] },
  B: { adjectives: ["Blazin'", 'Bold', "Burnin'", "Bumpin'"], names: ['Barry', 'Bo', 'Buck', 'Buddy', 'Bruno'] },
  C: { adjectives: ['Crazy', "Crankin'", 'Cool', 'Careless'], names: ['Carl', 'Chuck', 'Cody', 'Cal'] },
  D: { adjectives: ['Daring', "Dashin'", 'Dusty', 'Dangerous'], names: ['Davey', 'Dan', 'Duke', 'Dale'] },
  E: { adjectives: ['Eager', 'Electric', 'Edgy'], names: ['Eddie', 'Earl', 'Elmo'] },
  F: { adjectives: ['Fearless', 'Fast', 'Furious', "Flyin'"], names: ['Frankie', 'Fred', 'Finn', 'Floyd'] },
  G: { adjectives: ['Gutsy', "Grippin'", 'Gnarly', 'Greasy'], names: ['Gary', 'Gus', 'Grady', 'Griff'] },
  H: { adjectives: ['Hot-shot', "Howlin'", 'Heavy', 'Hasty'], names: ['Hank', 'Hal', 'Hondo', 'Huck'] },
  J: { adjectives: ["Jumpin'", "Jammin'", 'Jolty'], names: ['Jake', 'Jimmy', 'Joe', 'Junior'] },
  K: { adjectives: ["Kickin'", 'Keen', 'Krazy'], names: ['Kenny', 'Kip', 'Kurt'] },
  L: { adjectives: ['Lead-foot', 'Loose', 'Lightning', 'Lucky'], names: ['Luke', 'Larry', 'Lonnie', 'Lee'] },
  M: { adjectives: ['Mad', 'Maniac', 'Mighty', 'Muddy'], names: ['Manny', 'Mickey', 'Moe', 'Marty'] },
  N: { adjectives: ['Nitro', 'Nervy', 'Nasty'], names: ['Nate', 'Nick', 'Norm'] },
  P: { adjectives: ["Peelin'", 'Punchy', 'Pushy'], names: ['Pete', 'Petey', 'Paulie'] },
  Q: { adjectives: ['Quick', 'Quirky'], names: ['Quinn', 'Quincy'] },
  R: { adjectives: ['Rocket', 'Rowdy', 'Reckless', "Rippin'"], names: ['Rick', 'Randy', 'Rusty', 'Roscoe'] },
  S: { adjectives: ["Squealin'", 'Speedy', 'Slick', "Smokin'"], names: ['Sam', 'Sonny', 'Stu', 'Skip'] },
  T: { adjectives: ['Turbo', 'Tough', "Tearin'"], names: ['Tony', 'Tommy', 'Ty', 'Tank'] },
  V: { adjectives: ["Vroomin'", 'Vicious'], names: ['Vince', 'Vic'] },
  W: { adjectives: ['Wild', 'Wheelie', "Wailin'"], names: ['Wade', 'Wally', 'Wes', 'Wyatt'] },
  Z: { adjectives: ['Zippy', "Zoomin'", 'Zany'], names: ['Zane', 'Zeke'] },
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generate `count` distinct alliterative driver names. Cycles through shuffled
 * letters so drivers get varied initials before any letter repeats.
 */
export function generateDriverNames(count) {
  const letters = shuffle(Object.keys(POOL));
  const out = [];
  const used = new Set();

  for (let i = 0, guard = 0; out.length < count && guard < count * 50; guard++) {
    const group = POOL[letters[i % letters.length]];
    i++;
    const full = `${pick(group.adjectives)} ${pick(group.names)}`;
    if (used.has(full)) continue;
    used.add(full);
    out.push(full);
  }

  // Safety net if the pool were ever too small to fill the request.
  while (out.length < count) out.push(`Racer ${out.length + 1}`);
  return out;
}
