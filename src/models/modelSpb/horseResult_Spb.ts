export interface IHorseResult_Spb {
  id: number;
  stats_id: number | null; // FK para horse_stats_hr
  date: string | null; // armazenado como character varying
  position: number | null;
  course: string | null;
  distance: string | null;
  class: number | null;
  weight: string | null;
  starting_price: number | null;
  jockey: string | null;
  trainer: string | null;
  or_rating: number | null;
  race: string | null;
  prize: string | null;
  created_at?: string;
  updated_at?: string;
}
