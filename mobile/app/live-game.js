// mobile/app/live-game.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  AppState,
  KeyboardAvoidingView,
  Keyboard,
  Vibration,
  Dimensions,
  Animated,
  ActivityIndicator,
  Modal,
  TouchableWithoutFeedback,
  PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import LottieView from 'lottie-react-native';
import { useFonts, Tektur_400Regular, Tektur_700Bold } from '@expo-google-fonts/tektur';
import { supabase } from '../lib/supabase';
import { saveGameCompleted, getCounts, API_BASE } from '../lib/api';
import Logo from '../assets/images/footytrail_logo.png';

const INITIAL_TIME = 120; // 2 minutes
const AI_FACT_TIMEOUT_MS = 9000;
const MAX_DOTS = 9; // (no longer used for lists, kept to avoid style churn)

// ---- Local outro catalogue (no API calls) ----
// Buckets: win/lose × hints(0,1,2,5) × guesses(1..3)
// ---- Local outro catalogue (24 buckets × 20 lines each) ----
// Use .replaceAll("{{username}}", displayName) at render time.

const OUTRO_LINES = {
  win: {
    h0: {
      g1: [
        "No hints and first try — you’re cooking, {{username}}! 🔥",
        "Blindfolded bullseye, {{username}}. Ridiculous form. 🎯",
        "Pure instinct, first strike. Chef’s kiss, {{username}}. 👨‍🍳",
        "You didn’t even blink, {{username}}. Elite stuff. ⚡️",
        "Ghosted the hints and still scored. Ice cold, {{username}}. 🧊",
        "Natural born finisher — one look, one hit, {{username}}. 🏹",
        "That was telepathy, {{username}}. Zero hints, all brain. 🧠",
        "Clinical. You cut straight through, {{username}}. ✂️",
        "No warm-up needed — laser from you, {{username}}. 🔫",
        "Minimal info, maximum flex. Lovely, {{username}}. 💪",
        "You just speed-ran that, {{username}}. WR vibes. 🏁",
        "Sniper mode engaged, {{username}}. One shot. 🎯",
        "You read the game like a book, {{username}}. 📖",
        "Vintage you, {{username}} — no fuss, just finish. ✅",
        "That guess aged like fine wine instantly, {{username}}. 🍷",
        "You saw it before it happened, {{username}}. Visionary. 👁️",
        "Cold as the other side of the pillow, {{username}}. 🥶",
        "Efficiency 100%. File that under ‘routine’, {{username}}. 🗂️",
        "Boss level execution, {{username}}. 👑",
        "That wasn’t a guess, that was prophecy, {{username}}. 🔮",
      ],
      g2: [
        "Two swings, no hints — still classy, {{username}}. 👏",
        "Dialed in without peeking. Smooth, {{username}}. 😎",
        "You kept the visor down and landed it, {{username}}. ⛑️",
        "No hints, quick adjust, clean finish. Nice, {{username}}. 🧽",
        "You recalibrated like a pro, {{username}}. 🔧",
        "Second try supersonic, {{username}}. Boom. 💥",
        "You found the angle fast, {{username}}. 📐",
        "Zero clues, plenty of IQ. Love it, {{username}}. 🧠",
        "Tweaked and sealed it — pro work, {{username}}. 🛠️",
        "You bullied that solution into place, {{username}}. 💪",
        "Two taps to glory, {{username}}. Clean. ✅",
        "No hand-holding, just brains. Top stuff, {{username}}. 🧠",
        "You read the room and finished, {{username}}. 🏁",
        "Adapting on the fly — that’s you, {{username}}. 🦅",
        "A calm correction and bang. Class, {{username}}. 🧘",
        "Zero hints, high confidence. Love it, {{username}}. ❤️",
        "You ironed it out in seconds, {{username}}. 🧺",
        "Second guess masterclass, {{username}}. 🎓",
        "You kept the nerve and delivered, {{username}}. 🧊",
        "Textbook adjustment, {{username}}. 📚",
      ],
      g3: [
        "Made it dramatic, still no hints — clutch, {{username}}! 🔥",
        "Third time charm without clues. Nerves of steel, {{username}}. 🧊",
        "You wrestled it into the net, {{username}}. Respect. 💪",
        "No hints and you still closed it late. Winner’s mentality, {{username}}. 🏆",
        "Edge of the seat but you owned it, {{username}}. 🎢",
        "You kept believing — and cashed in, {{username}}. 💸",
        "That was grit, {{username}}. Proper grit. 🪨",
        "Storm weathered, result delivered, {{username}}. ⛈️→🌤️",
        "You walked the tightrope and stuck the landing, {{username}}. 🤸",
        "Drama merchant with a happy ending, {{username}}. 🎬",
        "Fashionably late, undeniably right, {{username}}. 🕰️",
        "You hunted it down without a single clue, {{username}}. 🐺",
        "Pressure? You ate it for breakfast, {{username}}. 🍽️",
        "That was stubborn brilliance, {{username}}. 🧠",
        "Final swing heroics from you, {{username}}. 🦸",
        "You turned chaos into points, {{username}}. ✨",
        "Third swing, still king. Nice, {{username}}. 👑",
        "You kept the faith, {{username}} — deserved. 🙌",
        "No hints, all heart. Love it, {{username}}. 💚",
        "You closed the chapter like a skipper, {{username}}. 📘",
      ],
    },
    h1: {
      g1: [
        "One hint, one hit — tidy, {{username}}. 🧽",
        "Used a nudge and struck gold, {{username}}. 🪙",
        "Minimal help, maximum finish. Class, {{username}}. 🎯",
        "That hint was fuel — you floored it, {{username}}. 🏎️",
        "Single clue, laser focus, {{username}}. ⚡️",
        "Scalpel work, {{username}} — one hint, one cut. 🔪",
        "You squeezed value from a single clue, {{username}}. 🍋",
        "Smart peek, perfect strike, {{username}}. ✅",
        "Little help, big brain, {{username}}. 🧠",
        "You translated the hint instantly, {{username}}. 🔤",
        "One breadcrumb and you baked a cake, {{username}}. 🎂",
        "Economy of clues — love that, {{username}}. 💼",
        "You turned a whisper into a cheer, {{username}}. 📣",
        "Single spark, full fire, {{username}}. 🔥",
        "That’s precision play, {{username}}. 🎯",
        "You didn’t need more. Sharp, {{username}}. ✂️",
        "Hint-efficient and lethal, {{username}}. ☑️",
        "You read it once and pounced, {{username}}. 🐆",
        "Clean move, clean finish, {{username}}. 🧼",
        "One clue, total control, {{username}}. 🕹️",
      ],
      g2: [
        "One hint set the path — you finished it, {{username}}. 🛣️",
        "Good read, quick adjust, win secured, {{username}}. 🔧",
        "You let the hint breathe and then struck, {{username}}. 🌬️",
        "That was tidy route-planning, {{username}}. 🗺️",
        "One clue, two taps, top result, {{username}}. ✅",
        "You built the picture fast, {{username}}. 🧩",
        "That hint aged well — and so did your guess, {{username}}. 🍷",
        "Smooth tempo, smart finish, {{username}}. 🎼",
        "You turned the key and drove home, {{username}}. 🔑",
        "Measured, composed, decisive — nice, {{username}}. 🧘",
        "Good intel, better execution, {{username}}. 🎯",
        "You didn’t rush it — that’s maturity, {{username}}. 🧑‍🍳",
        "One hint, clean closure, {{username}}. 🧳",
        "You guided it in like a pilot, {{username}}. ✈️",
        "Solid tempo, {{username}}. No panic, just points. 🧮",
        "You trimmed the fat and finished, {{username}}. ✂️",
        "Blueprint to reality in two, {{username}}. 📐",
        "Composed correction, sweet end, {{username}}. 🍭",
        "Hint whisper → correct roar, {{username}}. 🗣️",
        "Smooth operator vibes, {{username}}. 📞",
      ],
      g3: [
        "One hint, high drama, right answer — showman, {{username}}. 🎭",
        "You kept cool and closed late, {{username}}. 🧊",
        "Squeezed all the value from that single hint, {{username}}. 🍊",
        "You played the long game — and won it, {{username}}. ⏳",
        "Final-swing precision with just one clue, {{username}}. 🎯",
        "Stuck the landing, {{username}}. That’s poise. 🤸",
        "You made it cinematic and correct, {{username}}. 🎬",
        "One hint, three beats, one hero — {{username}}. 🦸",
        "You circled, lined up, and struck, {{username}}. 🛰️",
        "Right at the tape, {{username}}. Winner’s timing. 🏁",
        "You milked that hint expertly, {{username}}. 🥛",
        "Patience paid off, {{username}}. 💸",
        "You rode the wave to shore, {{username}}. 🌊",
        "Ice veins, {{username}}. Clutch city. 🧊",
        "You refused the fumble — strong, {{username}}. 🏈",
        "Drama converted to points — neat, {{username}}. ✨",
        "Played it like chess, finished like checkers, {{username}}. ♟️",
        "You engineered a win from scraps, {{username}}. 🔩",
        "That was calculated bravery, {{username}}. 🧮",
        "Final guess heroics — chef’s kiss, {{username}}. 👨‍🍳",
      ],
    },
    h2: {
      g1: [
        "Few hints, first strike — controlled dominance, {{username}}. 😎",
        "You turned clues into art in one go, {{username}}. 🎨",
        "Swift synthesis, perfect hit, {{username}}. 🧪",
        "You read the room and walked it home, {{username}}. 🚶",
        "Hints as stepping stones, you sprinted, {{username}}. 🪨🏃",
        "That was fluent, {{username}}. Clues → answer. 🔁",
        "You connected the dots instantly, {{username}}. •—•",
        "First try with setup work — pro behavior, {{username}}. 🧰",
        "You turned insight into impact, {{username}}. 💡→💥",
        "Calm, clinical, classy — {{username}}. ✅",
        "You made it look inevitable, {{username}}. 🧲",
        "Blueprint to building in one motion, {{username}}. 🏗️",
        "Clue-crafting masterclass, {{username}}. 🎓",
        "Processing speed off the charts, {{username}}. 📈",
        "You just speed-solved that, {{username}}. 🏎️",
        "Hints well spent — result deserved, {{username}}. 💳",
        "You front-loaded brainwork and cashed out, {{username}}. 💸",
        "One-touch brilliance after prep, {{username}}. ⚽️",
        "You staged it perfectly, {{username}}. 🎬",
        "First swing authority, {{username}}. 🧠",
      ],
      g2: [
        "Good scaffolding and a clean finish, {{username}}. 🏗️",
        "You navigated clues like a captain, {{username}}. ⛵️",
        "Measured steps, sharp end, {{username}}. 📏",
        "Hints did their job and so did you, {{username}}. 🤝",
        "Right tempo, right answer, {{username}}. 🎼",
        "You worked the angles then scored, {{username}}. 📐",
        "Orderly, tidy, effective — nice, {{username}}. 🧽",
        "You pieced it together perfectly, {{username}}. 🧩",
        "Two taps after groundwork — solid, {{username}}. 🧱",
        "Smooth conversion from clues, {{username}}. 🔄",
        "You kept control and finished, {{username}}. 🎯",
        "Hints spent wisely — ROI achieved, {{username}}. 📊",
        "You tuned the signal and struck, {{username}}. 📻",
        "No panic, just progress. Lovely, {{username}}. 🧘",
        "That was textbook assembly, {{username}}. 📚",
        "You set the table and feasted, {{username}}. 🍽️",
        "Strong craft, clean close, {{username}}. 🧰",
        "You unlocked it in stages, {{username}}. 🔓",
        "Orchestrated to perfection, {{username}}. 🎻",
        "Quality from start to finish, {{username}}. 🏁",
      ],
      g3: [
        "You ground it out and earned it, {{username}}. ⚙️",
        "Late finish after proper work — boss, {{username}}. 👔",
        "You trusted the process and were rewarded, {{username}}. 🧪",
        "Built patiently, finished decisively, {{username}}. 🧱",
        "That was a composed marathon, {{username}}. 🏃‍♂️",
        "You stayed tidy under pressure, {{username}}. 🧼",
        "You stacked the clues and struck, {{username}}. 📚",
        "Endgame excellence, {{username}}. ♟️",
        "You wore the puzzle down, {{username}}. 🪓",
        "Clutch close with crafted clues, {{username}}. 🔧",
        "You shepherded it home, {{username}}. 🐑",
        "Big-brain endurance, {{username}}. 🧠",
        "You kept the lid on and delivered, {{username}}. 🍲",
        "Patient hunter vibes, {{username}}. 🐺",
        "Methodical then merciless — love it, {{username}}. 🗡️",
        "You starved the doubt and fed the answer, {{username}}. 🍽️",
        "Final-beat accuracy, {{username}}. 🎯",
        "You turned pressure into polish, {{username}}. ✨",
        "That was grown-up puzzling, {{username}}. 🧑‍🏫",
        "You took the scenic route and still won, {{username}}. 🗺️",
      ],
    },
    h5: {
      g1: [
        "Full hint package, instant slam — efficient, {{username}}. ⚡️",
        "All clues loaded, first-try finish, {{username}}. 🎯",
        "You used the toolbox and hit top bin, {{username}}. 🧰",
        "Max assist, max precision, {{username}}. 🛠️",
        "That was clinical execution with support, {{username}}. ✅",
        "You turned guidance into greatness fast, {{username}}. 🌟",
        "Five peeks, zero doubts — boom, {{username}}. 💥",
        "No time wasted once prepped, {{username}}. ⏱️",
        "That was plug-and-play excellence, {{username}}. 🔌",
        "Everything aligned on first swing, {{username}}. 🧭",
        "You cashed in the clues perfectly, {{username}}. 💳",
        "Instant payoff from full info, {{username}}. 💸",
        "You choreographed that, {{username}}. 🩰",
        "Turbo-charged by intel — love it, {{username}}. 🚀",
        "No overthinking, just deliver, {{username}}. 📦",
        "You made the hints sing, {{username}}. 🎤",
        "That’s how to use resources, {{username}}. 🧠",
        "Five for foundation, one for finish. You, {{username}}. 🧱",
        "Prepared and precise, {{username}}. 🎯",
        "That was a clinic, {{username}}. 🩺",
      ],
      g2: [
        "Full brief, two taps — neat, {{username}}. 📝",
        "You turned all the lights green, {{username}}. 🟢",
        "Hints did the lifting, you did the finishing, {{username}}. 🤝",
        "Well-orchestrated win, {{username}}. 🎼",
        "You respected the process and cashed out, {{username}}. 💵",
        "Composed execution with all the data, {{username}}. 🧮",
        "You built certainty then sealed it, {{username}}. 🕹️",
        "Strong foundation, tidy apex, {{username}}. 🏗️",
        "Information → conversion — smooth, {{username}}. 🔄",
        "You drove the plan home, {{username}}. 🚚",
        "No chaos, only control, {{username}}. 🧊",
        "That was a deliberate two-step, {{username}}. 👣",
        "All hints, zero panic, sweet finish, {{username}}. 🍬",
        "You lined it up and posted it, {{username}}. 📮",
        "Clean two-touch masterclass, {{username}}. ⚽️",
        "You closed the loop, {{username}}. 🔁",
        "From brief to goal in two, {{username}}. 📝→🥅",
        "Measured and inevitable, {{username}}. 🧭",
        "You didn’t rush — you ruled, {{username}}. 👑",
        "Premium process, premium result, {{username}}. 🏆",
      ],
      g3: [
        "Max hints, late strike — still counts golden, {{username}}. 🥇",
        "You saw it through like a captain, {{username}}. ⛵️",
        "All the intel, all the patience — winner, {{username}}. 🧠",
        "You marched it over the line, {{username}}. 🥁",
        "There was never doubt, only timing, {{username}}. ⏳",
        "You managed the project to done, {{username}}. 📈",
        "Full toolkit, final-beat finish, {{username}}. 🧰",
        "You stayed composed to the whistle, {{username}}. 🧊",
        "Heavy prep, clutch delivery, {{username}}. 📦",
        "You landed the plane perfectly, {{username}}. ✈️",
        "That was executive composure, {{username}}. 👔",
        "You packaged chaos neatly, {{username}}. 📦",
        "Five hints, zero panic — strong, {{username}}. 💪",
        "You ran the playbook to the end, {{username}}. 📖",
        "Sturdy as they come, {{username}}. 🧱",
        "You did the hard yards and scored, {{username}}. 🏉",
        "Big finish energy, {{username}}. 🔋",
        "You took every edge and earned it, {{username}}. ✨",
        "Whistle-time winner, {{username}}. 🏁",
        "That was captain’s material, {{username}}. 🎖️",
      ],
    },
  },

  lose: {
    h0: {
      // lose → h0 (0 hints) → g0 (gave up before any guess)
      g0: [
        "You dipped before the first swing, {{username}}. Next time at least jab once. 🥊",
        "No hints, no guesses, no worries — tomorrow we press the green button, {{username}}. ▶️",
        "Gave up on Hard Mode? Try a hint or one swing, {{username}}. 🧠",
        "You stared it down… then bowed out. One guess won’t bite, {{username}}. 🐶",
        "Brave to walk away; braver to take a shot, {{username}}. 🎯",
        "Zero hints, zero guesses — that’s monk mode, {{username}}. Break the vow next time. 🧘",
        "Skipping the guess is the only guaranteed miss, {{username}}. 🧮",
        "You benched yourself, {{username}}. Next round, you’re starting eleven. 📝",
        "Consider this a tactical retreat, {{username}}. We charge tomorrow. 🗺️",
        "The riddle lives rent-free for now. Evict it tomorrow, {{username}}. 🧠",
        "No swing, no sting — but no glory, {{username}}. ⚖️",
        "Hard pass today; soft landing tomorrow, {{username}}. 🪂",
        "You kept the powder dry — now actually fire it next time, {{username}}. 💥",
        "You can’t score from the tunnel, {{username}}. Step on the pitch. ⚽️",
        "Giving up is tidy, winning is messy — choose mess next time, {{username}}. 🧼➡️🧪",
        "Respect the reset, {{username}}. But take one shot first. 🔁",
        "Even one guess tells a story, {{username}}. Write a line next time. ✍️",
        "Today was a timeout, {{username}}. Tomorrow: tip-off. 🏀",
        "You ghosted the puzzle, {{username}}. Text back tomorrow. 📱",
        "Zero attempts, zero regrets? We’ll fix at least one of those, {{username}}. 😉",
      ],
      g1: [
        "No hints and a swing — brave, {{username}}. Next one’s yours. 💚",
        "You went clean and paid the price — regroup, {{username}}. 🔄",
        "Bold attempt, {{username}}. Add a clue next time. 🧩",
        "Pure vibes can betray — steady on, {{username}}. ⚖️",
        "Close but clue-less — chin up, {{username}}. 🙂",
        "That’s heart, {{username}}. Let’s add brains tomorrow. 🧠",
        "No nets this time, {{username}}. We go again. 🔁",
        "You shot from the hip — reload smarter, {{username}}. 🔫",
        "Respect the swagger, {{username}}. Now respect a hint. 😏",
        "Fearless try, {{username}}. The puzzle owes you one. 🧩",
        "Sometimes the gut misfires, {{username}}. Keep swinging. 🥊",
        "You were nearly poetic — just no rhyme, {{username}}. 📝",
        "The line was there, not the name. Onwards, {{username}}. ➡️",
        "Zero hints is hardcore. Next time, sprinkle one, {{username}}. 🧂",
        "You chased glory the hard way, {{username}}. Valient. 🛡️",
        "Gutsy miss, {{username}}. Tomorrow bites back. 🌅",
        "That was fearless — now be cunning, {{username}}. 🦊",
        "We rate the audacity, {{username}}. Now rate a hint. ⭐",
        "You rolled the dice without reading the rules, {{username}}. 🎲",
        "Take a bow for bravery, {{username}}. Then take a hint. 🎭",
      ],
      g2: [
        "Two clean swings, no hints — stubborn, {{username}}. Try a clue. 🧠",
        "You’re allergic to hints, {{username}}. Consider therapy. 😅",
        "Strong chin, {{username}}. Maybe add a brain cell or two tomorrow. 🧪",
        "You tried to solo the raid, {{username}}. Bring support next time. 🛡️",
        "Honorable miss, {{username}}. The hint button won’t bite. 🐶",
        "Pride is heavy, {{username}}. Let a hint spot you. 🏋️",
        "You did it the scenic way and still missed, {{username}}. 🚗",
        "No clues, no cigar. Spark one, {{username}}. 🚬",
        "Solid effort, {{username}}. The map helps, promise. 🗺️",
        "You fought the fog, {{username}}. Consider headlights. 💡",
        "Hard mode selected — loss unlocked, {{username}}. 🎮",
        "You gave fate a fair chance, it said no. Next, {{username}}. 🧊",
        "That was noble stubbornness, {{username}}. 🏰",
        "Add just one hint and watch, {{username}}. ✨",
        "You’re a purist — the scoreboard isn’t. Balance, {{username}}. ⚖️",
        "No training wheels, wobbly landing, {{username}}. 🚲",
        "You tried telepathy — the player didn’t receive, {{username}}. 📡",
        "Stood tall, fell short. Happens, {{username}}. 🪵",
        "Guts 10/10, outcome 0/10. Adjust, {{username}}. 🎚️",
        "You boxed shadows bravely, {{username}}. 🥊",
      ],
      g3: [
        "Three blind swings, {{username}}. Time to open your eyes… to hints. 👀",
        "Epic stubborn arc, {{username}}. Respectfully: press the hint. 🔘",
        "You tried to out-stare the puzzle, {{username}}. It blinked never. 🫠",
        "Heroic, yes. Productive, no. Mix clues in, {{username}}. 🧪",
        "You did a marathon in the dark, {{username}}. Take a torch. 🔦",
        "Legend effort, {{username}}. Add information next time. ℹ️",
        "That was cinematic suffering, {{username}}. 🎬",
        "The vibes committee has adjourned. Hints now, {{username}}. 📝",
        "You ran out of luck, not heart, {{username}}. ❤️",
        "Stubborn king, crown withheld. Use a hint, {{username}}. 👑",
        "We admire the grit. We also admire hints, {{username}}. 🧠",
        "Three swings, no song. Get a tune next round, {{username}}. 🎻",
        "You arm-wrestled a riddle and lost, {{username}}. 💪🧩",
        "Bravery badge unlocked, {{username}}. Try the toolbox. 🧰",
        "Painfully close, painfully clue-less, {{username}}. 😬",
        "The scoreboard’s a harsh editor, {{username}}. ✏️",
        "All heart, zero clues — balance it, {{username}}. ⚖️",
        "That was ‘almost famous’, {{username}}. Be famous next. ⭐",
        "We move. With hints, {{username}}. ➡️",
        "Tomorrow, wisdom + courage, {{username}}. 🦁🧠",
      ],
    },
    h1: {
      // lose → h1 (exactly 1 hint) → g0 (gave up before any guess)
      g0: [
        "You paid for a peek then walked away, {{username}}. Use the ticket next time. 🎟️",
        "One hint in hand, no swing — that’s an unused superpower, {{username}}. 🦸",
        "You opened the door and didn’t step in, {{username}}. 🚪",
        "One clue is a spark; you forgot the match, {{username}}. 🔥",
        "You lined it up and cancelled the shot, {{username}}. 🧊",
        "That hint wanted a chance, {{username}}. Give it one tomorrow. 🎯",
        "You read the prologue and quit the book, {{username}}. 📖",
        "A single breadcrumb and no bite, {{username}}. 🍞",
        "You had the compass, skipped the trip, {{username}}. 🧭",
        "One hint is not a commitment ring, {{username}}. Try a guess. 💍",
        "You set the chessboard and called stalemate, {{username}}. ♟️",
        "That clue won’t forgive you unless you guess, {{username}}. 😅",
        "Almost brave, {{username}}. Next time: fully brave. 🦁",
        "You warmed up and left the gym, {{username}}. 🏋️",
        "The lane was open — you parked, {{username}}. 🛣️",
        "One peek is legal; one guess is required, {{username}}. ⚖️",
        "You prepped the canvas and didn’t paint, {{username}}. 🎨",
        "Great reconnaissance, {{username}}. No mission though. 🛰️",
        "You loaded the slingshot, no release, {{username}}. 🪃",
        "Tomorrow we cash that hint, {{username}}. 💳",
      ],
      g1: [
        "One hint wasn’t the magic word, {{username}}. Try two. 🔮",
        "Close with a nudge, but not enough, {{username}}. ➕",
        "You had the breadcrumb, missed the loaf, {{username}}. 🍞",
        "The compass pointed, you zig-zagged, {{username}}. 🧭",
        "Great idea, wrong name. Level up the clues, {{username}}. 📈",
        "One hint is a whisper. You needed a shout, {{username}}. 📣",
        "You grazed the target, {{username}}. Add intel next time. 🎯",
        "That clue deserved more glory, {{username}}. 😔",
        "Almost, {{username}}. Turn one hint into two and fly. 🪽",
        "You caught the scent but lost the trail, {{username}}. 🐾",
        "Right track, wrong station, {{username}}. 🚉",
        "You found the door, not the key, {{username}}. 🗝️",
        "Good instincts, underfed info. Fixable, {{username}}. 🔧",
        "You were in the neighborhood, {{username}}. Wrong house. 🏠",
        "Fine margins beat you today, {{username}}. ⚖️",
        "You needed one more puzzle piece, {{username}}. 🧩",
        "Solid read, thin evidence. Stack more, {{username}}. 📚",
        "That was a nearly, {{username}}. Add volume next. 🔊",
        "Good bones, no finish — yet, {{username}}. 🦴",
        "Tomorrow we escalate the clue count, {{username}}. 📈",
      ],
      g2: [
        "One hint stretched thin, {{username}}. Grab another. 🧶",
        "Your map was 60% complete, {{username}}. Fill the rest. 🗺️",
        "Balanced try, unbalanced result. Adjust, {{username}}. 🎚️",
        "You stitched a decent case, {{username}}. Missing thread. 🧵",
        "The idea was there; the name hid, {{username}}. 🫣",
        "You hovered over the answer, {{username}}. Land next time. 🛬",
        "One hint gave a lane; you drifted, {{username}}. 🚗",
        "You needed one more breadcrumb trail, {{username}}. 🍞",
        "Solid effort, {{username}}. The second clue unlocks. 🔓",
        "It teased you, {{username}}. Demand more info. 📣",
        "Your compass worked, coords didn’t, {{username}}. 🧭",
        "You painted the edges, not the center, {{username}}. 🎨",
        "Two guesses, one hint — mismatch, {{username}}. 🔁",
        "You were circling the name, {{username}}. Expand clues. 🛰️",
        "Respectable loss, {{username}}. Upgrade ammo. 🧰",
        "The riddle shrugged; shrug back with hints, {{username}}. 🤷",
        "Close enough to annoy you — good sign, {{username}}. 😅",
        "You ran out of runway, {{username}}. Extend with hints. 🛫",
        "The lock clicked but didn’t open, {{username}}. More pins. 🔐",
        "You’re one nudge away, {{username}}. ➕",
      ],
      g3: [
        "Stretched that single hint to the limit, {{username}}. Time to double up. ➕",
        "You gave us a thriller, {{username}}. Sequel needs more clues. 🎬",
        "You juggled too much with too little, {{username}}. Add one. 🤹",
        "Endgame slipped. Fuel it with hints next, {{username}}. ⛽️",
        "One hint in a marathon won’t cut it, {{username}}. 🏃",
        "You were architect and acrobat — missing tools, {{username}}. 🛠️",
        "Final guess drama, no pay-off. Upgrade info, {{username}}. 📈",
        "You boxed clever, came up short, {{username}}. 🥊",
        "Almost snapped into focus, {{username}}. Sharpen with clues. 🔎",
        "Right vibe, wrong badge, {{username}}. 🏷️",
        "You squeezed that hint dry, {{username}}. Need more juice. 🍊",
        "Close-out lacked grip, {{username}}. Get traction with intel. 🛞",
        "You tangoed with the name and tripped, {{username}}. 💃",
        "Decent case file, {{username}}. Missing page. 📄",
        "You found the chorus, not the lyric, {{username}}. 🎤",
        "The clock beat you, not the puzzle, {{username}}. ⏰",
        "You traced the silhouette, not the face, {{username}}. 🖼️",
        "Cliffhanger ending. Season 2: more hints, {{username}}. 📺",
        "You nearly pickpocketed the riddle, {{username}}. 🧥",
        "Next time we bully the mystery with clues, {{username}}. 💪",
      ],
    },
    h2: {
      // lose → h2 (2–4 hints) → g0 (gave up before any guess)
      g0: [
        "You built the scaffolding and walked off site, {{username}}. 🏗️",
        "So many clues, zero swing — the gods of puzzles are confused, {{username}}. 🫨",
        "You did the homework and skipped the test, {{username}}. ✍️",
        "That’s a premium warm-up for no main event, {{username}}. 🎟️",
        "You tuned the radio and muted the song, {{username}}. 📻",
        "Four breadcrumbs and no bite, {{username}}. 🍞",
        "The map was clear; the steps were zero, {{username}}. 🗺️",
        "All set-up, no punchline — we want jokes, {{username}}. 🎤",
        "You sharpened the blade and sheathed it, {{username}}. 🗡️",
        "You aligned the stars and went to sleep, {{username}}. 🌌",
        "You had advantage and called it off, {{username}}. ⚽️",
        "Strong prep, soft exit — upgrade the ending, {{username}}. 🎬",
        "You arranged the choir and cancelled the song, {{username}}. 🎶",
        "The key was in hand; door stayed shut, {{username}}. 🔑🚪",
        "You brewed the tea and forgot to sip, {{username}}. 🍵",
        "All green lights, parked anyway, {{username}}. 🟢🚗",
        "You stacked evidence, no verdict, {{username}}. ⚖️",
        "That was a TED Talk with no Q&A, {{username}}. 🎤",
        "Process A+, courage pending, {{username}}. 🧪",
        "Next time: same prep, one brave guess, {{username}}. ✅",
      ],
      g1: [
        "Two-plus hints and still a miss — unlucky, {{username}}. 🍀",
        "You built the scaffolding; the name slipped, {{username}}. 🏗️",
        "Plenty of clues, not enough click, {{username}}. 🧩",
        "The answer ducked late, {{username}}. We’ll trap it. 🪤",
        "Good framework, thin finish, {{username}}. 📐",
        "You were one spark short, {{username}}. 🔦",
        "It should’ve landed — football gods said no, {{username}}. ⚽️",
        "The pieces argued with each other, {{username}}. Mediator needed. 🧑‍⚖️",
        "Right study, wrong exam, {{username}}. ✍️",
        "You carved the statue, missed the face, {{username}}. 🗿",
        "So close you can taste it. Bitter now, sweet later, {{username}}. 🍬",
        "You played the notes, {{username}}. Tune missed. 🎼",
        "The model was sound — output wasn’t, {{username}}. 🤖",
        "That was a chess squeeze gone stale, {{username}}. ♟️",
        "We’ll reroute the logic next time, {{username}}. 🔁",
        "You found five doors, wrong building, {{username}}. 🚪",
        "It happens to the best — which is you, {{username}}. 😉",
        "Strong evidence, weak verdict, {{username}}. ⚖️",
        "You had the vibe deck stacked — top card hid, {{username}}. 🃏",
        "Good prep, bad bounce, {{username}}. 🏀",
      ],
      g2: [
        "Hints were there — the finish ghosted, {{username}}. 👻",
        "You zigged where the name zagged, {{username}}. 🌀",
        "You packed the backpack, forgot the map, {{username}}. 🎒",
        "Solid grind, sour end, {{username}}. 🍋",
        "The clues lined up… and then didn’t, {{username}}. 🧲",
        "You argued with reality and lost, {{username}}. 😅",
        "Great attempt, wrong latch, {{username}}. 🔒",
        "Data good, conclusion harsh, {{username}}. 📊",
        "Respectable craft, cruel result, {{username}}. 🪚",
        "You herded cats and one escaped, {{username}}. 🐈",
        "Nearly boxed in — gap appeared, {{username}}. 📦",
        "Two taps weren’t enough today, {{username}}. ➖",
        "You deserved better. Football says maybe tomorrow, {{username}}. ⏳",
        "That was a near-solve — not a fail in spirit, {{username}}. 💚",
        "You got the chorus wrong verse, {{username}}. 🎶",
        "We’ll bully it with more structure next time, {{username}}. 🧱",
        "Not a disaster, just unfinished, {{username}}. 🧩",
        "Tidy process, messy outcome, {{username}}. 🧼",
        "The door rattled but stayed shut, {{username}}. 🚪",
        "Leave it to simmer and return, {{username}}. 🍲",
      ],
      g3: [
        "You did the homework and still got curved, {{username}}. 📚",
        "Final swing fumbled — happens, {{username}}. 🏈",
        "You poured in effort, reward dodged, {{username}}. 🫥",
        "High drama, low mercy. Next time, {{username}}. 🎭",
        "Process perfect, ending cruel, {{username}}. 🎬",
        "You held composure; luck didn’t, {{username}}. 🎲",
        "Built like a cathedral, missed like a sparrow, {{username}}. ⛪️🕊️",
        "You were masterful till the finish, {{username}}. We move. ➡️",
        "The last turn betrayed you, {{username}}. 🔄",
        "You nearly scripted a miracle, {{username}}. 📝",
        "That was gladiator effort, {{username}}. 🗡️",
        "Clock conspired; we ignore it tomorrow, {{username}}. ⏰",
        "You squeezed every clue dry, {{username}}. 🍋",
        "Heart says win; scoreboard says later, {{username}}. ⌛️",
        "Endings are rude sometimes, {{username}}. 🙃",
        "You were inches off, {{username}}. Next inch is ours. 📏",
        "Big swing, thin contact. Reset, {{username}}. 🔁",
        "Agony is proof you were close, {{username}}. 💚",
        "You chased the ghost bravely, {{username}}. 👻",
        "Captain’s effort; unlucky tide, {{username}}. 🌊",
      ],
    },
    h5: {

      // lose → h5 (all 5 hints) → g0 (gave up before any guess)
      g0: [
        "Max hints and no attempt — that’s a Greek tragedy, {{username}}. 🎭",
        "You toured the museum and missed the gift shop, {{username}}. 🏛️",
        "Five peeks, zero punch — we want the swing, {{username}}. 🥊",
        "You collected infinity stones and didn’t snap, {{username}}. 🧤",
        "That was a full briefing with no mission, {{username}}. 🧳",
        "All systems go; countdown aborted, {{username}}. 🚀",
        "You solved the maze and didn’t exit, {{username}}. 🌀",
        "Five hints, no shot — the puzzle is laughing, {{username}}. 😏",
        "You wrote the recipe and didn’t cook, {{username}}. 🍳",
        "That’s deluxe analysis, budget bravery, {{username}}. 💼",
        "Every light green, no throttle — next time floor it, {{username}}. 🟢🏎️",
        "You rehearsed the finale and cancelled the show, {{username}}. 🎭",
        "We cannot VAR a guess that never happened, {{username}}. 📺",
        "All keys, no door tried, {{username}}. 🔑",
        "That was a boardroom masterclass with no decision, {{username}}. 👔",
        "You downloaded the answer pack and didn’t open file, {{username}}. 🗂️",
        "Five clues beg for one shot, {{username}}. Give them one. 🎯",
        "You marched to the penalty spot and walked off, {{username}}. 🥅",
        "Full tank, engine off — start it next time, {{username}}. ⛽️",
        "Ah, the rare perfect prep, zero attempt. We fix that tomorrow, {{username}}. 🔁",
      ],
      g1: [
        "All hints burned and still slipped — brutal, {{username}}}. 🥶",
        "You used the whole library; the book hid, {{username}}. 📚",
        "Max intel, zero mercy — annoying, {{username}}. 😤",
        "We emptied the toolbox; screw rolled away, {{username}}. 🔩",
        "You did everything right except win, {{username}}. Happens. 🤝",
        "That was exhaustive — and exhausting, {{username}}. 🥵",
        "Even with GPS, the road closed, {{username}}. 🛣️",
        "You followed the recipe, oven sulked, {{username}}. 🍞",
        "Five hints, no joy. Next time we storm it, {{username}}. ⚡️",
        "The map was perfect; the door was hidden, {{username}}. 🗺️",
        "You interrogated the riddle; it lawyered up, {{username}}. 👨‍⚖️",
        "Full brief, cruel twist, {{username}}. 🎭",
        "You did not lose; the answer delayed, {{username}}. ⏳",
        "All-in and the river bricked, {{username}}. 🃏",
        "You left nothing behind — respect, {{username}}. 🙇",
        "The gods of football were petty, {{username}}. ⚽️",
        "You maxed the hints; luck minimum, {{username}}. 🎲",
        "Boss effort, bad bounce, {{username}}. 🏀",
        "We chalk it up and march again, {{username}}. 🥁",
        "Sturdy spirit, unlucky script, {{username}}. ✍️",
      ],
      g2: [
        "Five hints, still no cigar — foul play by fate, {{username}}. 🚬",
        "You did the miles; the finish line moved, {{username}}. 🏁",
        "All cards on table, dealer said no, {{username}}. 🪙",
        "You chased it with a torch; it hid in daylight, {{username}}. 🌞",
        "Clinical process, savage ending, {{username}}. 🧊",
        "You squeezed every drop; barrel was dry, {{username}}. 🍊",
        "The logic was solid; outcome wasn’t, {{username}}. 🧱",
        "You threaded the needle then lost the cloth, {{username}}. 🪡",
        "Max hints, mid luck. Next, {{username}}. 🔁",
        "You wore the puzzle down; it played dead, {{username}}. 🪦",
        "Hard to blame you — easy to believe next time, {{username}}. 💚",
        "You orchestrated; the soloist ghosted, {{username}}. 🎻",
        "That was professional pain, {{username}}. 😮‍💨",
        "You deserved a bounce; didn’t get it, {{username}}. 🏀",
        "Endings can be liars. We rewrite, {{username}}. ✍️",
        "Five hints, two swings — fate shrugged, {{username}}. 🤷",
        "Brutal lesson, solid signs, {{username}}. 🧭",
        "You piloted perfectly; runway got short, {{username}}. ✈️",
        "Unfair result, fair effort — proud, {{username}}. 🫡",
        "We reload with the same conviction, {{username}}. 🔄",
      ],
      g3: [
        "Full hints, final swing, still not it — cruel, {{username}}. 🥶",
        "You marched all the way; gate stayed locked, {{username}}. 🚪",
        "Everything but the last click, {{username}}. 🔒",
        "You were exemplary; the end wasn’t, {{username}}. 🧾",
        "Five hints, long road, empty cup — next time, {{username}}. 🍵",
        "You carried the weight; luck skipped leg day, {{username}}. 🏋️",
        "All structure, no payoff — rare, {{username}}. 🧱",
        "You stared down the puzzle; it smirked, {{username}}. 😑",
        "That finale hurt — proof you were close, {{username}}. 💔",
        "We keep the process, change the ending, {{username}}. 🔁",
        "Captain’s shift, unlucky whistle, {{username}}. 🏴‍☠️",
        "You couldn’t have tried harder. Respect, {{username}}. 🙇",
        "Right approach, wrong universe, {{username}}. 🌌",
        "You reached for the crown; it ducked, {{username}}. 👑",
        "Tough pill, strong stomach, {{username}}. 💊",
        "You beat the puzzle on effort; scoreline lied, {{username}}. 📉",
        "War won in spirit, lost on paper, {{username}}. 📄",
        "You emptied the tank with pride, {{username}}. ⛽️",
        "We rally with the same heart, {{username}}. ❤️",
        "Next time the door opens, {{username}}. 🔓",
      ],
    },
  },
};


// Pick random line from array
function pickRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  const i = Math.floor(Math.random() * arr.length);
  return arr[i] || "";
}

// Determine hint bucket: 0, 1, 2–4, or 5
function hintBucket(n) {
  const x = Number(n) || 0;
  if (x === 0) return "h0";
  if (x === 1) return "h1";
  if (x >= 2 && x <= 4) return "h2";
  return "h5";
}

// Clamp guesses to 0..3, with a dedicated g0 for “gave up before any guess”
function guessBucket(n) {
  const x = Number(n) || 0;
  if (x <= 0) return "g0";
  if (x === 1) return "g1";
  if (x === 2) return "g2";
  return "g3";
}


function fetchWithTimeout(url, options = {}, ms = AI_FACT_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

const normalize = (str) =>
  (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const multipliers = {
  age: 0.9,
  nationality: 0.9,
  position: 0.8,
  partialImage: 0.5,
  firstLetter: 0.25,
};

async function fetchTransfersLocal(playerId) {
  try {
    const res = await fetch(`${API_BASE}/transfers/${encodeURIComponent(playerId)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return json?.transfers || [];
  } catch {
    return [];
  }
}

export default function LiveGameMobile() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();

  // Load Tektur fonts
  const [fontsLoaded] = useFonts({ Tektur_400Regular, Tektur_700Bold });

  // Accept either individual params or a single JSON `payload` param.
  const parsed = (() => {
    if (params?.payload) {
      try { return JSON.parse(String(params.payload)); } catch { /* ignore */ }
    }
    return {
      id: toNum(params?.id),
      name: safeStr(params?.name),
      age: toNum(params?.age),
      nationality: safeStr(params?.nationality),
      position: safeStr(params?.position),
      photo: safeStr(params?.photo),
      funFact: safeStr(params?.funFact),
      potentialPoints: toNum(params?.potentialPoints, 0),
      isDaily: String(params?.isDaily ?? '0') === '1',
      filters: parseJson(params?.filters) || { potentialPoints: 0 },
      elimination: parseJson(params?.elimination) || null,
    };
  })();

  const gameData = {
    id: parsed.id,
    name: parsed.name,
    age: parsed.age,
    nationality: parsed.nationality,
    position: parsed.position,
    photo: parsed.photo,
    funFact: parsed.funFact,
    potentialPoints: parsed.potentialPoints,
  };

  // ---- DOB source for hints/postgame ----
  const [dobAgeStr, setDobAgeStr] = useState(parsed.dobAge || '');

  // If parsed had it, keep in sync
  useEffect(() => {
    if (parsed.dobAge && parsed.dobAge !== dobAgeStr) setDobAgeStr(parsed.dobAge);
  }, [parsed.dobAge]);

  // If missing, fetch once from players_in_seasons by player_id
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (dobAgeStr || !gameData?.id) return;
      try {
        const { data, error } = await supabase
          .from('players_in_seasons')
          .select('player_dob_age')
          .eq('player_id', gameData.id)
          .not('player_dob_age', 'is', null)
          .limit(1)
          .maybeSingle();

        if (!cancelled && !error && data?.player_dob_age) {
          setDobAgeStr(String(data.player_dob_age));
        }
      } catch { }
    })();
    return () => { cancelled = true; };
  }, [dobAgeStr, gameData?.id]);

  const currentAge = useMemo(() => {
    const dob = parseBirthDate(dobAgeStr);
    if (!(dob instanceof Date) || Number.isNaN(dob.valueOf())) return null;
    const a = computeAgeFromDate(dob);
    return Number.isFinite(a) && a > 0 ? a : null;
  }, [dobAgeStr]);

  const isDaily = !!parsed.isDaily;
  const filters = parsed.filters || { potentialPoints: 0 };
  const elimination = parsed.elimination;

  const headerTitle = elimination ? 'Elimination' : (isDaily ? 'Daily Challenge' : 'Regular Daily');

  // If this is an elimination game and the round already started earlier,
  // start with the remaining round time (clamped to the default 2 minutes).
  const DEFAULT_START_SEC = 120; // keep as the general cap
  const endsAtMs = (() => {
    try { return elimination?.endsAt ? new Date(elimination.endsAt).getTime() : null; }
    catch { return null; }
  })();

  const initialStartSeconds = (() => {
    const roundLimit = Number(elimination?.timeLimitSeconds || DEFAULT_START_SEC);
    let base = Math.max(1, Math.min(roundLimit, DEFAULT_START_SEC)); // final cap
    if (endsAtMs && Number.isFinite(endsAtMs)) {
      const rem = Math.floor((endsAtMs - Date.now()) / 1000);
      if (Number.isFinite(rem) && rem > 0) {
        // take the smaller of “remaining in round” and “default/cap”
        base = Math.min(base, rem);
      } else {
        // If the round already ended, give a 1-second grace so the page can lose gracefully
        base = 1;
      }
    }
    return base;
  })();

  // Stable reference to the starting total used for elapsed/decay math
  const START_TIME = useRef(initialStartSeconds).current;

  // -------------------------
  // State
  // -------------------------
  const [guessesLeft, setGuessesLeft] = useState(3);
  const [guess, setGuess] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  const [usedHints, setUsedHints] = useState({
    age: false,
    nationality: false,
    position: false,
    partialImage: false,
    firstLetter: false,
  });

  const [displayName, setDisplayName] = useState('Player');
  // Avatar (same as postgame)
  const [avatarUrl, setAvatarUrl] = useState(null);

  const [timeSec, setTimeSec] = useState(initialStartSeconds);
  const timerRef = useRef(null);
  const endedRef = useRef(false);

  const [transferHistory, setTransferHistory] = useState([]);
  const [loadingTransfers, setLoadingTransfers] = useState(true);

  const [computedPotential, setComputedPotential] = useState(null);

  // AI fact
  const [aiFact, setAiFact] = useState('');
  const aiFactRef = useRef('');

  const [showConfetti, setShowConfetti] = useState(false);

  // NEW: finishing lock to keep dropdown closed & show animations until navigation
  const [isFinishing, setIsFinishing] = useState(false);

  // Effects
  const [showEmojiRain, setShowEmojiRain] = useState(false);
  const shakeX = useRef(new Animated.Value(0)).current;

  // Hints modal
  const [hintsVisible, setHintsVisible] = useState(false);
  // --- Sheet drag state for the Hints modal
  const sheetY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (hintsVisible) sheetY.setValue(0); // reset on open
  }, [hintsVisible]);

  // Pan anywhere on the sheet (header included) to drag down and dismiss
  const sheetPan = useRef(
    PanResponder.create({
      // Don’t steal taps immediately; wait for a vertical move intent
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),

      onPanResponderMove: (_, g) => {
        // drag down only
        if (g.dy > 0) sheetY.setValue(g.dy);
      },

      onPanResponderRelease: (_, g) => {
        const shouldClose = g.dy > 80 || g.vy > 0.8;
        if (shouldClose) {
          Animated.timing(sheetY, {
            toValue: 480,
            duration: 180,
            useNativeDriver: true,
          }).start(() => setHintsVisible(false));
        } else {
          Animated.spring(sheetY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      },
    })
  ).current;

  // Sticky thresholds
  const [showStickyTimer, setShowStickyTimer] = useState(false);
  const [showStickyInput, setShowStickyInput] = useState(false);
  const timerYRef = useRef(0);
  const inputYRef = useRef(0);

  // NEW: "Hints" floating button (appears after you’ve scrolled past the Hints card)
  const [showHintDock, setShowHintDock] = useState(false);

  // NEW: track Hints button
  const hintsYRef = useRef(0);

  // Header + sticky math
  const headerHeight = 56;
  const stickyTop = insets.top + headerHeight; // overlays anchor here
  const stickyOffset = headerHeight + 8;
  const TIMER_H = 84;      // exact height of the sticky timer row on your device
  const INPUT_MB = 6;      // marginBottom you set on the sticky input

  // --- measurements for precise auto-scroll when sticky hints shows
  const transfersYRef = useRef(0);
  const stickyInputHRef = useRef(0);
  const lastYRef = useRef(0);


  // Scroll ref (to scroll to top before FX)
  const scrollRef = useRef(null);

  // -------------------------
  // Bootstrapping (no timer here anymore)
  // -------------------------
  useEffect(() => {
    if (!gameData?.id || !gameData?.name) {
      Alert.alert('Missing data', 'No game payload found. Returning to Game.');
      router.replace('/(tabs)/game');
      return;
    }

    // Transfers
    (async () => {
      try {
        const th = await fetchTransfersLocal(gameData.id);
        setTransferHistory(Array.isArray(th) ? th : []);
        // Transfers are enough to enable the page UI; AI fact will be fetched separately
        setLoadingTransfers(false);
      } catch {
        setTransferHistory([]);
        setLoadingTransfers(false);
      }

    })();

    // Display name
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const uid = user?.id;
        const email = user?.email || '';
        if (uid) {
          const { data } = await supabase.from('users').select('full_name').eq('id', uid).maybeSingle();
          const dbName = (data?.full_name || '').trim();
          if (dbName) return setDisplayName(dbName);
        }
        setDisplayName(email.split('@')[0] || 'Player');
      } catch {
        setDisplayName('Player');
      }
    })();

    // Anti-cheat
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') loseNow();
    });

    return () => {
      clearInterval(timerRef.current);
      sub?.remove();
    };
  }, [gameData?.id, gameData?.name]);

  // Fetch AI fact in the background after transfers are ready
  useEffect(() => {
    if (!transferHistory || transferHistory.length === 0) return;
    if (aiFactRef.current) return; // already fetched or set

    let cancelled = false;
    (async () => {
      try {
        // 1) Try cached fact from the last 6 months (players_in_seasons)
        const sixMonthsAgoIso = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6).toISOString();

        const { data: cached, error: cacheErr } = await supabase
          .from('players_in_seasons')
          .select('ai_fact, ai_fact_created_at')
          .eq('player_id', gameData.id)
          .not('ai_fact', 'is', null)
          .gte('ai_fact_created_at', sixMonthsAgoIso)
          .order('ai_fact_created_at', { ascending: false })
          .limit(1);

        const cachedFact = (cached?.[0]?.ai_fact || '').trim();

        if (!cancelled && cachedFact) {
          aiFactRef.current = cachedFact;
          setAiFact(cachedFact);
          return; // cached hit — skip API
        }

        // 2) No fresh cached fact — fall back to existing API call (unchanged)
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetchWithTimeout(`${API_BASE}/ai/generate-player-fact`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            player: {
              id: gameData.id,
              name: gameData.name,
              nationality: gameData.nationality,
              position: gameData.position,
              age: gameData.age,
            },
            transferHistory: Array.isArray(transferHistory) ? transferHistory : [],
          }),
        }, AI_FACT_TIMEOUT_MS);

        const j = await resp.json().catch(() => ({}));
        const fact = String(j?.fact || j?.aiGeneratedFact || '').trim();
        if (!cancelled && fact) {
          aiFactRef.current = fact;
          setAiFact(fact);

          // Only persist REAL facts — skip playful fallback banter
          if (!j?.isFallback) {
            const { data: rowsUpdated, error: rpcErr } = await supabase.rpc('save_player_ai_fact', {
              p_player_id: Number(gameData.id),
              p_fact: fact,
            });

          }
        }
      } catch {
        // swallow — no fact shown if both cache and API fail
      }
    })();

    return () => { cancelled = true; };

  }, [transferHistory, gameData?.id]);

  // Start countdown ONLY after transfers are fully loaded
  useEffect(() => {
    clearInterval(timerRef.current);
    if (loadingTransfers || endedRef.current) return;
    timerRef.current = setInterval(() => {
      setTimeSec((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          if (!endedRef.current) {
            endedRef.current = true;
            setIsFinishing(true);
            setSuggestions([]);
            setGuess('');
            Keyboard.dismiss();
            // Scroll to top BEFORE rain
            try { scrollRef.current?.scrollTo({ y: 0, animated: true }); } catch { }
            setTimeout(() => setShowEmojiRain(true), 180);
            setTimeout(async () => {
              const attempts = Math.max(0, 3 - guessesLeft);
              await saveGameRecord(false, attempts);
              await writeElimEntryAndAdvance(false, 0);
              const outroLine = await generateOutro(false, 0, attempts, START_TIME);
              const renderedOutro = outroLine.replaceAll("{{username}}", displayName);
              goPostgame({
                didWin: false,
                pointsEarned: 0,
                elapsed: START_TIME,
                guessesUsed: attempts,
                outroLine: renderedOutro,
              });

            }, 1200);

          }
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [loadingTransfers]);

  // Avatar (load from users.profile_photo_url)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData?.user?.id;
        if (!userId) return;
        const { data } = await supabase
          .from('users')
          .select('profile_photo_url')
          .eq('id', userId)
          .maybeSingle();
        if (mounted && data?.profile_photo_url) setAvatarUrl(data.profile_photo_url);
      } catch { }
    })();
    return () => { mounted = false; };
  }, []);

  // -------------------------
  // Potential points
  // -------------------------
  useEffect(() => {
    (async () => {
      const provided = Number(gameData?.potentialPoints || 0);
      if (provided > 0) { setComputedPotential(provided); return; }

      try {
        const { data: { user } } = await supabase.auth.getUser();
        const uid = user?.id || null;

        const payload = {
          competitions: filters?.competitions || [],
          seasons: filters?.seasons || [],
          minMarketValue: Number(filters?.minMarketValue || 0),
          minAppearances: Number(filters?.minAppearances || 0),
          userId: uid,
        };

        const counts = await getCounts(payload).catch(() => null);
        const pool = Number(counts?.poolCount || 0);
        const calculated = pool > 0 ? pool * 5 : 10000;
        setComputedPotential(calculated);
      } catch {
        setComputedPotential(10000);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameData?.id]);

  // -------------------------
  // Suggestions (debounced)
  // -------------------------
  useEffect(() => {
    // NEW: once finishing, force-close suggestions and do nothing else
    if (isFinishing || endedRef.current) {
      setSuggestions([]);
      return;
    }

    let active = true;
    const id = setTimeout(async () => {
      const q = String(guess || '').trim();
      if (!q || q.length < 3) {
        if (active) setSuggestions([]);
        return;
      }
      try {
        setIsLoadingSuggestions(true);
        const { data, error } = await supabase.rpc('suggest_names', { q, lim: 50 });
        if (error) throw error;

        const rows = Array.isArray(data) ? data : [];
        const pickPhoto = (r) =>
          r.photo || r.player_photo || r.player_photo_url || r.photo_url || r.avatar || r.image || r.img || null;

        // Group by normalized name, collect up to 3 photos for each group
        const groups = new Map();
        for (const r of rows) {
          const display = String(r.player_name ?? r.name ?? r.display ?? r.player_norm_name ?? r.norm ?? '').trim();
          if (!display) continue;
          const key = normalize(display);

          const pickPhoto = (row) =>
            row.photo ||
            row.player_photo ||
            row.player_photo_url ||
            row.photo_url ||
            row.avatar ||
            row.image ||
            row.img ||
            null;

          const g = groups.get(key) || { id: key, display, photos: [], total: 0 };
          g.total += 1;

          const p = pickPhoto(r);
          if (p && !g.photos.includes(p) && g.photos.length < 3) {
            g.photos.push(p);
          }

          groups.set(key, g);
        }

        if (active) setSuggestions(Array.from(groups.values()));

      } catch {
        if (active) setSuggestions([]);
      } finally {
        if (active) setIsLoadingSuggestions(false);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [guess, isFinishing]);

  // -------------------------
  // Points (incl. wrong guess ×0.66)
  // -------------------------
  const isGenericPhoto = useMemo(() => {
    const url = gameData?.photo || '';
    return /\/default\.jpg(\?|$)/i.test(url);
  }, [gameData?.photo]);

  // For elimination games, force a 10,000 starting potential (like Daily).
  const potentialPointsSource = Number(
    gameData?.potentialPoints
    || (elimination ? 10000 : (filters?.potentialPoints || computedPotential || 0))
  );


  const points = useMemo(() => {
    let p = potentialPointsSource;

    Object.keys(usedHints).forEach((k) => {
      if (!usedHints[k]) return;
      if (k === 'partialImage' && isGenericPhoto) return;
      p = Math.floor(p * multipliers[k]);
    });

    // Time decay begins only once countdown actually runs (we don't decrement before transfers load)
    const timeElapsed = START_TIME - timeSec;
    const timeDecay = Math.pow(0.99, timeElapsed);
    p = Math.floor(p * timeDecay);

    const wrongAttempts = Math.max(0, 3 - guessesLeft);
    p = Math.floor(p * Math.pow(0.66, wrongAttempts));

    return Math.max(0, p);
  }, [potentialPointsSource, usedHints, timeSec, guessesLeft, isGenericPhoto]);

  // -------------------------
  // Effects: shake
  // -------------------------
  const doShake = () => {
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 5, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -5, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  // -------------------------
  // Actions
  // -------------------------
  const reveal = (key) => setUsedHints((u) => ({ ...u, [key]: true }));

  const submitGuess = async (value) => {
    const v = String(value ?? '').trim();
    if (!v || endedRef.current) return;

    // Close suggestions on any guess & hide keyboard
    setSuggestions([]);
    setGuess('');
    Keyboard.dismiss();

    // Vibrate on every guess (small tap)
    Vibration.vibrate(20);

    const correct = v.toLowerCase() === (gameData?.name || '').trim().toLowerCase();

    if (correct) {
      endedRef.current = true;
      setIsFinishing(true);
      clearInterval(timerRef.current);

      // Scroll to top BEFORE confetti
      try { scrollRef.current?.scrollTo({ y: 0, animated: true }); } catch { }
      setTimeout(() => setShowConfetti(true), 180);

      setTimeout(async () => {
        const guessesUsed = Math.min(3, Math.max(0, (3 - guessesLeft) + 1));
        await saveGameRecord(true, guessesUsed);

        await writeElimEntryAndAdvance(true, points);
        const elapsed = START_TIME - timeSec;
        const outroLine = await generateOutro(true, points, guessesUsed, elapsed);
        const renderedOutro = outroLine.replaceAll("{{username}}", displayName);
        goPostgame({
          didWin: true,
          pointsEarned: points,
          elapsed,
          guessesUsed,
          outroLine: renderedOutro,
        });
      }, 1200);
      return;
    }

    // ❌ wrong → vibrate + shake + decrement or lose
    Vibration.vibrate(50);
    doShake();

    if (guessesLeft <= 1) {
      endedRef.current = true;
      setIsFinishing(true);
      clearInterval(timerRef.current);

      setSuggestions([]);
      setGuess('');
      Keyboard.dismiss();

      // Scroll to top BEFORE emoji rain
      try { scrollRef.current?.scrollTo({ y: 0, animated: true }); } catch { }
      setTimeout(() => setShowEmojiRain(true), 180);

      setTimeout(async () => {
        // We just made a wrong guess that ended the game.
        // Since guessesLeft hasn't been decremented in this branch,
        // the actual attempts = (3 - guessesLeft) + 1
        const attempts = Math.min(3, Math.max(0, (3 - guessesLeft) + 1));
        await saveGameRecord(false, attempts);
        await writeElimEntryAndAdvance(false, 0);
        const elapsed = START_TIME - timeSec;
        const outroLine = await generateOutro(false, 0, attempts, elapsed);
        const renderedOutro = outroLine.replaceAll("{{username}}", displayName);
        goPostgame({
          didWin: false,
          pointsEarned: 0,
          elapsed,
          guessesUsed: attempts,
          outroLine: renderedOutro,
        });
      }, 1200);

    } else {
      setGuessesLeft((g) => g - 1);
    }
  };

  const loseNow = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setIsFinishing(true);
    clearInterval(timerRef.current);

    // Vibrate on Give up, close suggestions & keyboard
    Vibration.vibrate(60);
    setSuggestions([]);
    setGuess('');
    Keyboard.dismiss();

    // Scroll to top BEFORE emoji rain
    try { scrollRef.current?.scrollTo({ y: 0, animated: true }); } catch { }
    setTimeout(() => setShowEmojiRain(true), 180);

    setTimeout(async () => {
      const attempts = Math.max(0, 3 - guessesLeft); // typically 0 on immediate give-up
      await saveGameRecord(false, attempts);
      await writeElimEntryAndAdvance(false, 0);
      const elapsed = START_TIME - timeSec;
      const outroLine = await generateOutro(false, 0, attempts, elapsed);
      const renderedOutro = outroLine.replaceAll("{{username}}", displayName);
      goPostgame({
        didWin: false,
        pointsEarned: 0,
        elapsed,
        guessesUsed: attempts,
        outroLine: renderedOutro,
      });
    }, 1200);

  };

  const saveGameRecord = async (won, attemptsOverride) => {
    try {
      // --- Resolve auth FIRST and keep it stable for the whole function
      const [{ data: sess }, { data: authData }] = await Promise.all([
        supabase.auth.getSession(),
        supabase.auth.getUser(),
      ]);
      const uid = authData?.user?.id || null;
      if (!uid) {
        // Don’t hit the server with an empty user — this is what caused {"error":"Missing userId in request"}
        console.error('[saveGameRecord] No user id available at save time; aborting save to avoid server error.');
        return null;
      }

      const playerIdNumeric = Number(gameData?.id);
      if (!playerIdNumeric || Number.isNaN(playerIdNumeric)) throw new Error('Missing playerData.id');

      const playerData = {
        id: playerIdNumeric,
        name: gameData.name,
        nationality: gameData.nationality,
        position: gameData.position,
        age: gameData.age,
        photo: gameData.photo,
      };

      const attempts =
        Number.isFinite(attemptsOverride)
          ? Math.max(0, Math.min(3, attemptsOverride))
          : Math.max(0, Math.min(3, 3 - guessesLeft + (won ? 1 : 0)));

      const gameStats = {
        won,
        points: won ? points : 0,
        potentialPoints: potentialPointsSource,
        timeTaken: START_TIME - timeSec,
        guessesAttempted: attempts,
        hintsUsed: Object.values(usedHints).filter(Boolean).length,
        isDaily: !!isDaily,
        is_elimination_game: !!elimination,
      };

      // --- Elimination flow: write games_records + RPC with the same uid we resolved above
      if (elimination?.roundId && elimination?.tournamentId) {
        const { data: grInsert, error: grErr } = await supabase
          .from('games_records')
          .insert([{
            user_id: uid,
            player_id: playerIdNumeric,
            player_name: gameData.name,
            player_data: playerData,
            is_daily_challenge: !!isDaily,
            is_elimination_game: true,
            guesses_attempted: gameStats.guessesAttempted,
            time_taken_seconds: gameStats.timeTaken,
            points_earned: gameStats.points,
            potential_points: gameStats.potentialPoints,
            hints_used: gameStats.hintsUsed,
            completed: true,
            won: gameStats.won,
          }])
          .select('id')
          .single();

        if (grErr) { console.error('[games_records insert] error:', grErr); return null; }

        const { error } = await supabase.rpc('play_elimination_round', {
          p_round_id: elimination.roundId,
          p_user_id: uid,
          p_game: { game_record_id: grInsert.id },
        });
        if (error) { console.error('[play_elimination_round] error:', error); return null; }
        return true;
      }

      // --- Regular/Daily flow: pass the SAME uid into the body (no inline getUser() that can race to null)
      const body = {
        userId: uid,
        playerData,
        gameStats,
        is_elimination_game: !!elimination,
      };

      // keep using your helper; it already posts to your API
      const resp = await saveGameCompleted(body);
      if (resp && resp.error) {
        console.error('[saveGameCompleted] error:', resp.error);
        return null;
      }
      return true;
    } catch (err) {
      console.error('Error in saveGameRecord:', err);
      return null;
    }
  };

  const writeElimEntryAndAdvance = async () => {
    if (!elimination?.roundId || !elimination?.tournamentId) return;
    try {
      const { error } = await supabase.rpc('advance_elimination_tournament', {
        p_tournament_id: elimination.tournamentId,
      });
      if (error) console.error('[advance_elimination_tournament] error:', error);
    } catch (e) {
      console.error('[advance_elimination_tournament] exception:', e);
    }
  };

  const generateOutro = (won, pts, guessesUsed, elapsedSec) => {
    const hintCount = Object.values(usedHints).filter(Boolean).length;

    const hBucket = hintBucket(hintCount);
    const gBucket = guessBucket(guessesUsed);
    const mode = won ? "win" : "lose";

    const lines = OUTRO_LINES?.[mode]?.[hBucket]?.[gBucket] ?? [];
    return pickRandom(lines);
  };


  const goPostgame = ({ didWin, pointsEarned, elapsed, guessesUsed, outroLine }) => {
    router.replace({
      pathname: '/postgame', params: {
        aiFact: aiFactRef.current || aiFact || '',
        didWin: didWin ? '1' : '0',
        player: JSON.stringify({
          id: gameData.id,
          name: gameData.name,
          photo: gameData.photo,
          dob_age: dobAgeStr,
          nationality: gameData.nationality,
          position: gameData.position,
          funFact: gameData.funFact,
        }),
        stats: JSON.stringify({
          pointsEarned,
          timeSec: elapsed,
          guessesUsed,
          usedHints,
        }),
        filters: JSON.stringify(filters),
        isDaily: isDaily ? '1' : '0',
        potentialPoints: String(potentialPointsSource),
        outroLine: outroLine || '',
        elimination: JSON.stringify(elimination || null),
      },
    });
  };

  // -------------------------
  // Render helpers
  // -------------------------
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const timeTone =
    timeSec <= 30 ? styles.timeRed :
      timeSec <= 60 ? styles.timeYellow : styles.timeNormal;
  const guessesTone = guessesLeft <= 1 ? styles.guessRed : (guessesLeft === 2 ? styles.guessWarn : styles.guessNormal);

  const displayPotential = Number(potentialPointsSource || 0);

  // Suggestion list renderer (used in sticky + original)
  const renderSuggestions = () => {
    // NEW: hide suggestions entirely during finishing
    if (isFinishing) return null;

    if (isLoadingSuggestions) return <Text style={styles.loadingTxt}>Loading…</Text>;
    if (!suggestions.length) return null;

    return (
      <ScrollView
        style={styles.sugList}
        contentContainerStyle={{ paddingVertical: 4 }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {suggestions.map((item, index) => (
          <TouchableOpacity
            key={item.id ?? item.display ?? index}
            style={styles.sugItem}
            activeOpacity={0.8}
            onPress={() => {
              setGuess(item.display);
              setSuggestions([]);
              setGuess('');
              submitGuess(item.display);
              Keyboard.dismiss();
            }}
          >
            {item.photos?.length ? (
              <AvatarStack photos={item.photos} total={item.total} />
            ) : (
              <View style={styles.sugAvatarFallback}>
                <Text style={styles.sugAvatarFallbackText}>
                  {(item.display?.[0] || '?').toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.sugName}>{item.display}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  };

  if (!fontsLoaded) return null; // wait for Tektur

  // -------------------------
  // UI
  // -------------------------
  const screenW = Dimensions.get('window').width;
  const innerPad = 16;

  const disabledUI = loadingTransfers; // disable interactions + dim until transfers are loaded

  return (
    <Animated.View style={{ flex: 1, backgroundColor: '#F0FDF4', transform: [{ translateX: shakeX }] }}>
      {/* Safe area background + absolute header */}
      <SafeAreaView edges={['top']} style={styles.safeArea} />
      <View style={[styles.header, { top: insets.top }]}>
        <View style={styles.headerSide}>
          <Image source={Logo} style={styles.headerLogo} />
        </View>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, { backgroundColor: '#d1d5db' }]} />
          )}
        </View>
      </View>

      {/* Sticky overlays */}
      {showStickyTimer && (
        <View style={[styles.stickyRow, { top: stickyTop }]}>
          <View style={[styles.card, styles.flex1, styles.center, { paddingVertical: 8, opacity: disabledUI ? 0.5 : 1 }]}>
            <Text style={[styles.timer, timeTone]}>{formatTime(timeSec)}</Text>
            <Text style={styles.subtle}>Time left</Text>
          </View>
          <View style={[styles.card, styles.flex1, styles.center, { paddingVertical: 8, opacity: disabledUI ? 0.5 : 1 }]}>
            <Text style={[styles.bigNumber, guessesTone]}>{guessesLeft}</Text>
            <Text style={styles.subtle}>Guesses left</Text>
          </View>
        </View>
      )}

      {/* Sticky Stack: below the timer row */}
      {showStickyInput && (
        <View style={[styles.stickyInput, { top: stickyTop + 84 /* under timer row */ }]}>
          {/* Sticky Input (unchanged content) */}
          {showStickyInput && (
            <View
              style={[styles.card, { padding: 10, opacity: disabledUI ? 0.5 : 1, marginBottom: 6 /* tighter gap */ }]}
              pointerEvents={disabledUI ? 'none' : 'auto'}
              onLayout={(e) => { stickyInputHRef.current = e.nativeEvent.layout.height; }}
            >
              <View style={styles.inputRow}>
                <TextInput
                  value={guess}
                  onChangeText={(t) => setGuess(String(t))}
                  placeholder="Type a player's name"
                  autoFocus={false}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isFinishing && !endedRef.current && !disabledUI}
                />
                <TouchableOpacity onPress={loseNow} style={styles.giveUpBtn} activeOpacity={0.8} disabled={isFinishing || disabledUI}>
                  <Text style={styles.giveUpText}>Give up</Text>
                </TouchableOpacity>
              </View>

              {/* Suggestions shown inside sticky card */}
              {renderSuggestions()}
            </View>
          )}
        </View>
      )}

      {/* Floating “Hints” dock button */}
      {showHintDock && (
        <TouchableOpacity
          onPress={() => setHintsVisible(true)}
          activeOpacity={0.9}
          style={[
            styles.hintsDockBtn,
            {
              top:
                stickyTop +
                (showStickyTimer ? TIMER_H : 0) +
                (showStickyInput ? (stickyInputHRef.current || 0) + INPUT_MB : 0) +
                12,
            },
          ]}
        >
          <Text style={styles.hintsDockIcon}>👁️</Text>
        </TouchableOpacity>
      )}

      {/* Content */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        keyboardVerticalOffset={0}
      >
        <View style={{ flex: 1 }} pointerEvents={disabledUI ? 'none' : 'auto'}>
          <ScrollView
            ref={scrollRef}
            style={styles.screen}
            contentContainerStyle={[styles.screenContent, { paddingTop: headerHeight + 8, opacity: disabledUI ? 0.5 : 1 }]}
            contentInsetAdjustmentBehavior="never"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScroll={(e) => {
              const y = e.nativeEvent.contentOffset.y;
              lastYRef.current = y;

              // Base offset = header overlap
              const base = headerHeight + 8;

              // 1) TIMER: becomes sticky when its top hits under the header
              const timerThresh = (timerYRef.current ?? 0) - base;
              const nextShowTimer = y >= timerThresh;
              setShowStickyTimer(nextShowTimer);

              // 2) INPUT: becomes sticky when its top reaches just under the header + (timer if already sticky)
              const inputThresh = (inputYRef.current ?? 0) - base - (nextShowTimer ? TIMER_H : 0);
              const nextShowInput = y >= inputThresh;
              setShowStickyInput(nextShowInput);


              // 3) HINTS DOCK: show the floating button once we scrolled past the Hints card
              const stackAbove =
                (nextShowTimer ? TIMER_H : 0) +
                (nextShowInput ? (stickyInputHRef.current || 0) + INPUT_MB : 0);

              const hintsTopInViewport = (hintsYRef.current ?? 0) - base - stackAbove;
              // When the Hints card top is above the visible area by ~12px, show the dock button.
              const shouldShowDock = y >= hintsTopInViewport + 12;
              setShowHintDock(shouldShowDock);

            }}
            scrollEventThrottle={16}
          >
            {/* Warning */}
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>⚠️ Don’t leave this screen — backgrounding the app will count as a loss.</Text>
            </View>

            {/* Timer + Guesses */}
            <View
              style={styles.row}
              onLayout={(e) => { timerYRef.current = e.nativeEvent.layout.y; }}
            >
              <View style={[styles.card, styles.flex1, styles.center]}>
                <Text style={[styles.timer, timeTone]}>{formatTime(timeSec)}</Text>
                <Text style={styles.subtle}>Time left</Text>
              </View>
              <View style={[styles.card, styles.flex1, styles.center]}>
                <Text style={[styles.bigNumber, guessesTone]}>{guessesLeft}</Text>
                <Text style={styles.subtle}>Guesses left</Text>
              </View>
            </View>

            {/* Current points */}
            <View style={styles.row}>
              <View style={[styles.card, styles.flex1, styles.center]}>
                <Text style={styles.potentialInline}>
                  Potential Points: <Text style={styles.potentialStrong}>{displayPotential}</Text>
                </Text>
                <Text style={styles.pointsNow}>{points}</Text>
              </View>
            </View>

            {/* Guess input row */}
            <View
              style={styles.card}
              onLayout={(e) => { inputYRef.current = e.nativeEvent.layout.y; }}
            >
              <Text style={styles.sectionTitle}>Who are ya?!</Text>

              <View style={styles.inputRow}>
                <TextInput
                  value={guess}
                  onChangeText={(t) => setGuess(String(t))}
                  placeholder="Type a player's name"
                  autoFocus={false}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isFinishing && !endedRef.current && !disabledUI}
                />

                <TouchableOpacity onPress={loseNow} style={styles.giveUpBtn} activeOpacity={0.8} disabled={isFinishing || disabledUI}>
                  <Text style={styles.giveUpText}>Give up</Text>
                </TouchableOpacity>
              </View>

              {/* Only render suggestions here when NOT sticky */}
              {!showStickyInput && renderSuggestions()}
            </View>

            {/* Hints opener (between input and transfers) */}
            <View
              style={styles.card}
              onLayout={(e) => { hintsYRef.current = e.nativeEvent.layout.y; }}
            >
              <TouchableOpacity
                onPress={() => setHintsVisible(true)}
                activeOpacity={0.9}
                style={styles.hintsOpenBtn}
                disabled={isFinishing || disabledUI}
              >
                <Text style={styles.hintsOpenText}>🧐 Need a hint? 👁️</Text>


                {/* Hints status chips (now on the button card) */}
                <View style={[styles.hintsChipRow, { justifyContent: 'center', paddingVertical: 8 }]}>
                  {[
                    { key: 'age', label: 'Age' },
                    { key: 'nationality', label: 'Nat' },
                    { key: 'position', label: 'Pos' },
                    { key: 'partialImage', label: 'Img' },
                    { key: 'firstLetter', label: '1st L' },
                  ].map((h) => {
                    const used = !!usedHints?.[h.key];
                    return (
                      <View
                        key={h.key}
                        style={[
                          styles.hintChip,
                          used ? styles.hintChipUsed : styles.hintChipAvail,
                        ]}
                      >
                        <Text style={used ? styles.hintChipTextUsed : styles.hintChipTextAvail}>
                          {h.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </TouchableOpacity>
            </View>

            {/* Transfer History — LIST (no swipe) */}
            <View
              style={styles.card}
              onLayout={(e) => { transfersYRef.current = e.nativeEvent.layout.y; }}
            >
              <Text style={styles.sectionTitle}>Transfer History</Text>
              {loadingTransfers ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator />
                  <Text style={styles.loadingTxt}>Loading transfers…</Text>
                </View>
              ) : (
                <View style={{ gap: 12 }}>
                  {transferHistory?.length
                    ? transferHistory.map((t, idx) => (
                      <TransferSlide key={`${t.date || t.season || 'row'}-${idx}`} t={t} /* width auto in list */ />
                    ))
                    : <Text style={styles.emptyTransfers}>No transfers found.</Text>}
                </View>
              )}
            </View>

            {/* Bottom spacer */}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* Hints Modal */}
      <Modal
        visible={hintsVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setHintsVisible(false)}
        onDismiss={() => setHintsVisible(false)} // handle swipe dismiss
      >
        <View style={styles.modalBackdrop}>
          {/* BACKDROP: full-screen layer that closes on tap */}
          <TouchableWithoutFeedback onPress={() => setHintsVisible(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          {/* SHEET: centered; header swipe-down drags & dismisses */}
          <Animated.View style={[styles.modalCard, { transform: [{ translateY: sheetY }] }]}>
            <View style={styles.modalHeader} {...sheetPan.panHandlers /* or header pan if you named it so */}>
              <Text style={styles.modalTitle}>Hints</Text>
              <TouchableOpacity
                onPress={() => setHintsVisible(false)}
                style={styles.modalCloseBtn}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
              <View style={{ gap: 12 }}>
                <HintButton
                  label={"Player's Age"}
                  multiplier="×0.90"
                  disabled={usedHints.age || currentAge == null || disabledUI}
                  onPress={() => !disabledUI && !usedHints.age && reveal('age')}
                  valueShown={usedHints.age && currentAge != null ? String(currentAge) : null}
                />

                <HintButton
                  label="Nationality"
                  multiplier="×0.90"
                  disabled={usedHints.nationality || !gameData?.nationality || disabledUI}
                  onPress={() => !disabledUI && !usedHints.nationality && reveal('nationality')}
                  valueShown={usedHints.nationality ? String(gameData?.nationality) : null}
                />
                <HintButton
                  label={"Player's Position"}
                  multiplier="×0.80"
                  disabled={usedHints.position || !gameData?.position || disabledUI}
                  onPress={() => !disabledUI && !usedHints.position && reveal('position')}
                  valueShown={usedHints.position ? String(gameData?.position) : null}
                />
                <HintButton
                  label={"Player's Image"}
                  multiplier="×0.50"
                  disabled={usedHints.partialImage || !gameData?.photo || disabledUI}
                  onPress={() => !disabledUI && !usedHints.partialImage && reveal('partialImage')}
                  valueShown={
                    usedHints.partialImage ? (
                      <View style={styles.hintCropBox}>
                        <Image source={{ uri: gameData?.photo }} style={styles.hintCroppedImage} />
                      </View>
                    ) : null
                  }
                />
                <HintButton
                  label={"Player's First Letter"}
                  multiplier="×0.25"
                  disabled={usedHints.firstLetter || !gameData?.name || disabledUI}
                  onPress={() => !disabledUI && !usedHints.firstLetter && reveal('firstLetter')}
                  valueShown={usedHints.firstLetter ? String(gameData?.name?.[0]?.toUpperCase() || '') : null}
                />
              </View>
            </ScrollView>
          </Animated.View>
        </View>

      </Modal>

      {/* Confetti (win) */}
      {showConfetti && (
        <LottieView
          source={require('../assets/animations/confetti.json')}
          autoPlay
          loop={false}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}

      {/* Lost animation (lose) */}
      {showEmojiRain && (
        <LottieView
          source={require('../assets/animations/lost.json')}
          autoPlay
          loop={false}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}

    </Animated.View>
  );
}

// -------------------------
// Subcomponents
// -------------------------
function HintButton({ label, multiplier, onPress, disabled, valueShown, style }) {
  const hasValue = valueShown !== null && valueShown !== undefined && valueShown !== '';
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={!disabled ? onPress : undefined}
      activeOpacity={0.8}
      style={[
        styles.hintBtn,
        hasValue ? styles.hintBtnRevealed : disabled ? styles.hintBtnDisabled : null,
        style,
      ]}
    >
      <View style={styles.hintHeader}>
        <Text style={[styles.hintLabel, hasValue && styles.hintLabelRevealed]}>{label}</Text>
        <Text style={[styles.hintMult, hasValue && styles.hintMultRevealed]}>Points {multiplier}</Text>
      </View>

      {hasValue ? (
        typeof valueShown === 'string' || typeof valueShown === 'number' ? (
          <Text style={styles.hintValue}>{valueShown}</Text>
        ) : (
          <View style={styles.hintImageWrap}>{valueShown}</View>
        )
      ) : null}
    </TouchableOpacity>
  );
}

function AvatarStack({ photos = [], total = 0 }) {
  // Show up to 3 overlapping avatars; if more, show a "+N" pill
  const shown = photos.slice(0, 3);
  const extra = Math.max(0, total - shown.length);
  return (
    <View style={styles.stackWrap}>
      {shown.map((uri, idx) => (
        <Image
          key={`${uri}-${idx}`}
          source={{ uri }}
          style={[styles.stackAvatar, { left: idx * 18, zIndex: 10 + idx }]}
        />
      ))}
      {extra > 0 && (
        <View style={[styles.stackMore, { left: Math.min(shown.length, 3) * 18 }]}>
          <Text style={styles.stackMoreText}>
            {extra > 99 ? '99+' : `+${extra}`}
          </Text>
        </View>
      )}
    </View>
  );
}

function TransferSlide({ t, width }) {
  const isFuture = (() => {
    if (!t?.date) return false;
    const d = new Date(t.date);
    if (isNaN(d.getTime())) return false;
    return d > new Date();
  })();

  return (
    <View style={[styles.transferSlide, width ? { width } : null]}>
      {/* Season + Date */}
      <View style={styles.transferColA}>
        <View style={styles.chip}><Text style={styles.chipText}>{t.season || '—'}</Text></View>
        <Text style={styles.transferDate}>{t.date || '—'}</Text>
      </View>

      {/* From → To */}
      <View style={styles.transferColB}>
        <ClubPill logo={t.out?.logo} name={t.out?.name} flag={t.out?.flag} />
        <Text style={styles.arrow}>{'→'}</Text>
        <ClubPill logo={t.in?.logo} name={t.in?.name} flag={t.in?.flag} />
      </View>

      {/* Value + Type + Future */}
      <View style={styles.transferColC}>
        <View style={styles.chip}><Text style={styles.chipText}>{formatFee(t.valueRaw ?? '')}</Text></View>
        {!!t.type && <View style={styles.chip}><Text style={styles.chipText}>{t.type}</Text></View>}
        {isFuture && <View style={[styles.chip, styles.chipFuture]}><Text style={[styles.chipText, styles.chipFutureText]}>Future Transfer</Text></View>}
      </View>
    </View>
  );
}

function ClubPill({ logo, name, flag }) {
  return (
    <View style={styles.clubPill}>
      <View style={styles.clubIcons}>
        {logo ? <Image source={{ uri: logo }} style={styles.clubLogo} /> : null}
        {flag ? <Image source={{ uri: flag }} style={styles.clubFlag} /> : null}
      </View>
      <Text numberOfLines={1} style={styles.clubName}>{name || 'Unknown'}</Text>
    </View>
  );
}

// -------------------------
// Styles
// -------------------------
const styles = StyleSheet.create({
  safeArea: { backgroundColor: 'white' },
  screen: { flex: 1 },
  screenContent: { padding: 16, gap: 12 },

  header: {
    height: 56,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 50,
  },
  headerSide: { width: 56, alignItems: 'flex-start', justifyContent: 'center' },
  headerLogo: { width: 40, height: 40, borderRadius: 6, resizeMode: 'contain' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: '#111827', fontFamily: 'Tektur_700Bold' },

  stickyRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 40,
    flexDirection: 'row',
    gap: 12,
  },
  stickyInput: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 35,
  },

  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    borderWidth: 1, borderColor: '#eef1f6',
  },

  warnBox: { backgroundColor: '#fffbeb', borderColor: '#fde68a', borderWidth: 1, borderRadius: 16, padding: 12 },
  warnText: { color: '#92400e', fontWeight: '600', textAlign: 'center', fontFamily: 'Tektur_400Regular' },

  row: { flexDirection: 'row', gap: 12 },
  flex1: { flex: 1 },
  center: { alignItems: 'center' },

  timer: { fontSize: 28, fontWeight: '800', fontFamily: 'Tektur_700Bold' },
  timeRed: { color: '#dc2626' },
  timeYellow: { color: '#ca8a04' },
  timeNormal: { color: '#111827' },

  subtle: { color: '#6b7280', fontFamily: 'Tektur_400Regular' },

  bigNumber: { fontSize: 28, fontWeight: '800', color: '#111827', fontFamily: 'Tektur_700Bold' },
  pointsNow: { fontSize: 28, fontWeight: '800', color: '#b45309', marginTop: 2, fontFamily: 'Tektur_700Bold' },

  potentialInline: { fontSize: 12, color: '#374151', fontFamily: 'Tektur_400Regular' },
  potentialStrong: { fontWeight: '800', color: '#111827', fontFamily: 'Tektur_700Bold' },

  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, fontFamily: 'Tektur_700Bold' },

  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  input: {
    flex: 1,
    borderWidth: 1, borderColor: '#e5e7eb',
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    borderRadius: 10, backgroundColor: 'white', fontSize: 16,
    fontFamily: 'Tektur_400Regular',
  },
  giveUpBtn: { backgroundColor: '#dc2626', paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center' },
  giveUpText: { color: 'white', fontWeight: '700', fontFamily: 'Tektur_700Bold' },

  loadingTxt: { color: '#6b7280', fontFamily: 'Tektur_400Regular' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }, // ← ADDED

  sugList: { marginTop: 8, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, maxHeight: 260, backgroundColor: 'white' },
  sugItem: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10 },
  sugAvatar: { width: 32, height: 32, borderRadius: 16, resizeMode: 'cover' },
  sugAvatarFallback: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  sugAvatarFallbackText: { fontSize: 12, color: '#6b7280', fontWeight: '700', fontFamily: 'Tektur_700Bold' },
  sugName: { fontSize: 14, color: '#111827', fontFamily: 'Tektur_400Regular' },

  // Hints & Transfers (list styles reuse existing)
  transferSlide: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12 },

  hintBtn: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 12 },
  hintBtnDisabled: { backgroundColor: '#f9fafb' },
  hintBtnRevealed: { backgroundColor: '#ecfdf5', borderColor: '#bbf7d0' },
  hintHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hintLabel: { fontSize: 14, fontWeight: '600', color: '#111827', fontFamily: 'Tektur_700Bold' },
  hintLabelRevealed: { color: '#065f46' },
  hintMult: { marginLeft: 4, fontSize: 12, color: '#6b7280', fontFamily: 'Tektur_400Regular' },
  hintMultRevealed: { color: '#10b981' },
  hintChip: { marginLeft: 'auto', fontSize: 10, fontWeight: '800', color: '#065f46', backgroundColor: '#d1fae5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, textTransform: 'uppercase', fontFamily: 'Tektur_700Bold' },
  hintValue: { marginTop: 6, fontSize: 22, fontWeight: '800', color: '#065f46', fontFamily: 'Tektur_700Bold' },
  hintImageWrap: { marginTop: 10, alignItems: 'center' },

  hintCropBox: { width: 128, height: 128, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: '#6ee7b7' },
  hintCroppedImage: { width: 128, height: 192, resizeMode: 'cover' },

  emptyTransfers: { color: '#6b7280', textAlign: 'center', fontFamily: 'Tektur_400Regular' },
  transferColA: { alignItems: 'center', marginBottom: 8 },
  transferDate: { fontSize: 12, color: '#6b7280', marginTop: 2, fontFamily: 'Tektur_400Regular' },
  transferColB: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginVertical: 6 },
  transferColC: { alignItems: 'center', gap: 6, marginTop: 4 },
  arrow: { color: '#9ca3af', fontFamily: 'Tektur_400Regular' },
  clubPill: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 240 },
  clubIcons: { alignItems: 'center', marginRight: 2 },
  clubLogo: { width: 24, height: 24, borderRadius: 6, resizeMode: 'contain' },
  clubFlag: { width: 20, height: 14, borderRadius: 3, marginTop: 2, resizeMode: 'cover' },
  clubName: { flexShrink: 1, fontSize: 13, color: '#111827', fontFamily: 'Tektur_400Regular' },

  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8, borderColor: '#e2e8f0' },
  chipText: { fontSize: 12, fontWeight: '700', fontFamily: 'Tektur_700Bold' },

  chipFuture: { backgroundColor: '#dbeafe', borderColor: '#bfdbfe' },
  chipFutureText: { color: '#1e40af' },
  guessNormal: { color: '#111827' },
  guessWarn: { color: '#ca8a04' },
  guessRed: { color: '#dc2626' },
  headerAvatar: { width: 28, height: 28, borderRadius: 14 },
  fxOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999 },

  // Hints opener
  hintsOpenBtn: { alignItems: 'center' },
  hintsOpenText: { fontSize: 16, fontWeight: '800', color: '#111827', fontFamily: 'Tektur_700Bold' },
  hintsOpenSub: { marginTop: 4, fontSize: 12, color: '#6b7280', fontFamily: 'Tektur_400Regular' },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  modalCard: {
    backgroundColor: 'white',
    borderRadius: 16,           // all corners (was top-only)
    padding: 16,
    width: '92%',               // nice centered width
    maxWidth: 520,              // optional cap for tablets
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    borderWidth: 1,
    borderColor: '#eef1f6',
  },

  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: '#111827', fontFamily: 'Tektur_700Bold' },
  modalCloseBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#111827', borderRadius: 8 },
  modalCloseText: { color: 'white', fontWeight: '700', fontFamily: 'Tektur_700Bold' },

  hintsDockBtn: {
    position: 'absolute',
    right: -2,              // slightly off the edge, “attached” feel
    width: 46,
    height: 46,
    borderTopLeftRadius: 23,
    borderBottomLeftRadius: 23,
    borderTopRightRadius: 23,
    borderBottomRightRadius: 23,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  hintsDockIcon: {
    fontSize: 20,
    fontWeight: '800',
  },



  // Hints chips
  hintsChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hintChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  hintChipAvail: {
    backgroundColor: '#ecfdf5', // light green-ish
    borderColor: '#a7f3d0',
  },
  hintChipUsed: {
    backgroundColor: '#f3f4f6', // light gray
    borderColor: '#e5e7eb',
  },
  hintChipTextAvail: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065f46',
    fontFamily: 'Tektur_700Bold',
  },
  hintChipTextUsed: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    fontFamily: 'Tektur_700Bold',
  },

  stackWrap: {
    width: 90,              // enough room for overlap + "+N"
    height: 32,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  stackAvatar: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,         // white ring so overlaps look clean
    borderColor: '#fff',
  },
  stackMore: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    zIndex: 100,
  },
  stackMoreText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
    fontFamily: 'Tektur_700Bold',
  },

});

/* ------------------------- helpers ------------------------- */
function safeStr(v) { return v == null ? '' : String(v); }
function toNum(v, def = 0) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function parseJson(v) { try { return v ? JSON.parse(String(v)) : null; } catch { return null; } }
function formatFee(raw) {
  if (!raw) return '—';
  let s = String(raw);
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
  s = s.replace(/^\s*(Loan\s*fee:|Fee:)\s*/i, '');
  s = s.replace(/^\$/, '€').replace(/\$/g, '€').trim();
  return s || '—';
}

// Accepts "30.04.1992 (29)", "dd/mm/yyyy", "dd-mm-yyyy", "yyyy-mm-dd"
function parseBirthDate(str) {
  if (!str) return null;
  // Strip "(xx)" season-age suffix if present
  const s = String(str).replace(/\(\d+\)/, '').trim();

  let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    if (validYMD(y, mo, d)) return new Date(Date.UTC(y, mo - 1, d));
  }

  m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    if (validYMD(y, mo, d)) return new Date(Date.UTC(y, mo - 1, d));
  }

  m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    if (validYMD(y, mo, d)) return new Date(Date.UTC(y, mo - 1, d));
  }

  return null;
}

function validYMD(y, m, d) {
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  return true;
}

function computeAgeFromDate(birthDate) {
  if (!(birthDate instanceof Date)) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const mo = now.getUTCMonth() - birthDate.getUTCMonth();
  if (mo < 0 || (mo === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age--;
  }
  return Math.max(0, age);
}
