export interface HabitStats {
  totalCheckins: number;
  currentStreak: number;
  bestStreak: number;
  completionRate: number; // Last 30 days
}

export interface HabitWithStats {
  id: string;
  title: string;
  description: string | null;
  createdAt: Date;
  stats: HabitStats;
}
