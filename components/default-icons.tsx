import {
  Bird,
  BedDouble,
  Brush,
  Car,
  Cat,
  CookingPot,
  Crown,
  Dog,
  Fish,
  Flower2,
  Gamepad2,
  Ghost,
  Heart,
  IceCream,
  Leaf,
  ListTodo,
  Moon,
  Music,
  PawPrint,
  Rabbit,
  Refrigerator,
  Rocket,
  ShoppingCart,
  ShowerHead,
  Shirt,
  Smile,
  Sofa,
  Sparkles,
  Sprout,
  Star,
  Sun,
  Trash2,
  Utensils,
  WashingMachine
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ChoreIconId, UserIconId } from '../lib/default-icons';

/**
 * The component-layer half of `lib/default-icons.ts`, for the same reason
 * `components/state-icons.ts` is the component half of `statePresentation`:
 * a stored name becomes a component in exactly one place, so the setup wizard,
 * the day list, the chore list and an avatar cannot disagree about what a
 * chore or a resident looks like.
 */
export const CHORE_ICONS: Readonly<Record<ChoreIconId, LucideIcon>> = Object.freeze({
  dishes: Utensils,
  trash: Trash2,
  laundry: WashingMachine,
  clothes: Shirt,
  bathroom: ShowerHead,
  cooking: CookingPot,
  fridge: Refrigerator,
  sweep: Brush,
  tidy: Sparkles,
  bed: BedDouble,
  pets: PawPrint,
  plants: Sprout,
  shopping: ShoppingCart,
  car: Car,
  living: Sofa,
  task: ListTodo
});

export const USER_ICONS: Readonly<Record<UserIconId, LucideIcon>> = Object.freeze({
  smile: Smile,
  star: Star,
  heart: Heart,
  crown: Crown,
  rocket: Rocket,
  cat: Cat,
  dog: Dog,
  rabbit: Rabbit,
  bird: Bird,
  fish: Fish,
  flower: Flower2,
  sun: Sun,
  moon: Moon,
  leaf: Leaf,
  music: Music,
  game: Gamepad2,
  iceCream: IceCream,
  ghost: Ghost
});
