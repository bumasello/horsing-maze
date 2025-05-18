import { supabase } from "../../../..";

export const savePredictionFeature = async (feature: any) => {
  try {
    const { error } = await supabase
      .from("prediction_horse_features")
      .upsert(feature, {
        onConflict: "race_horse_id,race_id", // Evita duplicatas
        ignoreDuplicates: false, // Atualiza se já existir
      });

    if (error) {
      throw new Error(
        `Erro ao salvar feature de previsão: ${JSON.stringify(error)}`,
      );
    }
  } catch (error) {
    console.error("Erro ao salvar feature de previsão:", error);
    throw error;
  }
};
