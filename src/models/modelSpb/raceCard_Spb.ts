export interface IRaceCard_Spb {
  id: number; // chave primária (bigserial)
  id_race: string | null;
  course: string | null;
  date: string | null; // armazenado como date (formato "YYYY-MM-DD")
  off_time_br: string | null;
  title: string | null;
  distance: string | null;
  age: number | null;
  going: string | null;
  finished: number | null;
  canceled: number | null;
  finish_time: string | null;
  prize: string | null;
  class: number | null;
  created_at?: string;
  updated_at?: string;
}
