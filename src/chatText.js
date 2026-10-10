// Nettoyage du texte du chat, partagé par le client (src/chat.js) et le relais (server/rooms.mjs) : fonction pure, sans DOM.
// Retire les caractères de contrôle (dont les sauts de ligne et tabulations, remplacés par une espace) et les marques bidirectionnelles
// (qui permettraient d'inverser l'affichage d'une ligne), réduit les espaces, coupe à maxLen CARACTÈRES (points de code : jamais au milieu d'un
// emoji). Renvoie '' si ce n'est pas du texte ou si rien ne reste. L'affichage, lui, se fait toujours par textContent (jamais innerHTML).
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function cleanChat(text, maxLen) {
  if (typeof text !== 'string') return '';
  const t = text.slice(0, maxLen * 4).replace(CONTROLS, ' ').replace(/ {2,}/g, ' ').trim(); // coupe d'abord : un message géant ne coûte rien
  return Array.from(t).slice(0, maxLen).join('').trim();
}
