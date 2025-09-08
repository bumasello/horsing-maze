export interface IRaceHorse_Spb {
  id: number;
  racecard_id: number | null;
  horse: string | null;
  id_horse: number | null;
  jockey: string | null;
  trainer: string | null;
  age: number | null;
  weight: string | null;
  number: number | null;
  last_ran_days_ago: number | null;
  non_runner: number | string;
  form: string | null;
  position: number | null;
  distance_beaten: string | null;
  owner: string | null;
  sire: string | null;
  dam: string | null;
  or_rating: number | null;
  sp: string | null;
  created_at?: string;
  updated_at?: string;
}
