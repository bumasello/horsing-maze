import { supabase } from "../..";

const BUCKET_NAME = "modelos-tfjs-publicos";
const AGENT_MODEL_NAME = "GEMINI_1_5_PRO"; // Adicione esta constante
const MODEL_BASE_PATH = `horse_probability_model/${AGENT_MODEL_NAME}`; // Novo caminho base

interface ModelPaths {
  modelJsonPath: string;
  normJsonPath: string;
  timestamp: string;
}

export async function getLatestModelPathFromSupabase_v3(): Promise<ModelPaths | null> {
  console.log(`Buscando modelos em ${BUCKET_NAME}/${MODEL_BASE_PATH}/`);
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .list(`${MODEL_BASE_PATH}/`, {
      // Altere aqui para usar MODEL_BASE_PATH
      limit: 100,
      sortBy: { column: "name", order: "desc" },
    });

  if (error) {
    console.log("Erro ao listar modelos no Supabase: ", error);
    return null;
  }

  if (data && data.length > 0) {
    console.log(
      "Itens encontrados no bucket:",
      data.map((item) => item.name),
    );

    // Ajuste o regex para corresponder apenas ao timestamp, já que estamos listando o conteúdo da pasta do agente
    const regex = /^\d{8}T\d{6}(\.\d{3})?Z$/;
    console.log("Regex para filtragem:", regex.source);

    const versionFolders = data.filter((item) => {
      // O item.name agora será apenas o nome da pasta de timestamp (ex: '20250719T192818891Z')
      const match = item.name.match(regex);
      if (match) {
        console.log(`Item '${item.name}' CORRESPONDE ao regex.`);
      } else {
        console.log(`Item '${item.name}' NÃO CORRESPONDE ao regex.`);
      }
      return match;
    });

    if (versionFolders.length > 0) {
      console.log(
        "Pastas de versão encontradas:",
        versionFolders.map((item) => item.name),
      );
      const latestVersionFolder = versionFolders[0].name;

      // Ajuste os caminhos para incluir o AGENT_MODEL_NAME
      const modelJsonPath = `horse_probability_model/${AGENT_MODEL_NAME}/${latestVersionFolder}/model.json`;
      const normJsonPath = `horse_probability_model/${AGENT_MODEL_NAME}/${latestVersionFolder}/normalization.json`;
      const timestamp = latestVersionFolder;

      console.log(
        `Caminho do modelo mais recente encontrado: ${modelJsonPath}`,
      );

      return { modelJsonPath, normJsonPath, timestamp };
    }
  }
  console.log("Nenhuma versão de modelo encontrada no Supabase.");
  return null;
}
