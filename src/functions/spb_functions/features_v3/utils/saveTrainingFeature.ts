import { supabase } from "../../../..";

export const saveTrainingFeature = async (feature: any): Promise<void> => {
  try {
    const { error } = await supabase
      .schema("hml")
      .from("training_horse_features")
      .upsert(feature, {
        onConflict: "race_horse_id,race_id", // Evita duplicatas
        ignoreDuplicates: false, // Atualiza se já existir
      });

    if (error) {
      throw new Error(
        `Erro ao salvar feature de treinamento: ${JSON.stringify(error)}`,
      );
    }
  } catch (error) {
    console.error("Erro ao salvar feature de treinamento:", error);
    throw error;
  }
};
