import { redirect } from "next/navigation";

/** La pantalla principal es el inventario. */
export default function Inicio() {
  redirect("/reglas");
}
