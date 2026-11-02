// La sample consume la configuración compilada desde este repositorio, igual que la sample
// C# consume Lainco.Analyzers desde el feed local. Antes hay que compilar los paquetes:
//
//   cd src/ts && npm ci && npm run build
//
// La clave del proyecto de Sonar se pasa a mano porque el repositorio analiza con el
// scanner de .NET y no tiene sonar-project.properties (equivale a LaincoSonarProyecto).
import { configurar } from "../../src/ts/eslint-config/dist/index.js";

export default [
  ...configurar({ sonar: { proyecto: "revertpablo_Lainco-quality", organizacion: "revertpablo" } }),
];
