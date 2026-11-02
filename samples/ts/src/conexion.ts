// Conexión a una base de datos de ejemplo.

export class Conexion {
  // >>> lainco/no-hardcoded-secrets
  private readonly password = "hunter2";

  // Contraejemplo: el secreto llega por el constructor.
  constructor(private readonly usuario: string, private readonly token: string) {}

  abrir(): string {
    // Contraejemplo: un texto con espacios es de interfaz, no un secreto.
    const passwordHint = "Pedile la contraseña al administrador";
    return `${this.usuario}:${this.password}:${this.token}:${passwordHint}`;
  }
}
