import type { Community, Member, Message } from './model.js';

/** Explicit demo seed data. No identity, presence or messages here come from a server. */
export const demoCommunities: Community[] = [
  {
    id: 'nuvex',
    name: 'nu.vex',
    initials: 'nu',
    color: '#14D392',
    description: 'Un lugar para construir algo nuestro.',
    channels: [
      { id: 'welcome', name: 'bienvenida', kind: 'text', category: 'COMUNIDAD', description: 'Empieza aquí. Una comunidad abierta desde el primer día.' },
      { id: 'announcements', name: 'anuncios', kind: 'text', category: 'COMUNIDAD', description: 'Lo último del proyecto, paso a paso.', unread: 2 },
      { id: 'general', name: 'general', kind: 'text', category: 'COMUNIDAD', description: 'Ideas, conversaciones y un poco de todo.' },
      { id: 'ideas', name: 'ideas-y-feedback', kind: 'text', category: 'CONSTRUYENDO JUNTOS', description: 'Dale forma a la próxima versión.', unread: 3 },
      { id: 'development', name: 'desarrollo', kind: 'text', category: 'CONSTRUYENDO JUNTOS', description: 'Código, preguntas y pequeñas victorias.' },
      { id: 'design', name: 'diseño', kind: 'text', category: 'CONSTRUYENDO JUNTOS', description: 'Píxeles con intención.' },
      { id: 'lounge', name: 'Sala de estar', kind: 'voice', category: 'ESPACIOS DE VOZ', description: 'Próximamente: conversaciones de voz.' },
      { id: 'cowork', name: 'Enfocados', kind: 'voice', category: 'ESPACIOS DE VOZ', description: 'Próximamente: un espacio para trabajar en compañía.' },
    ],
  },
  {
    id: 'design-lab',
    name: 'Design Lab',
    initials: 'dl',
    color: '#B1A0ED',
    description: 'Exploramos ideas, compartimos procesos.',
    channels: [
      { id: 'lab-general', name: 'general', kind: 'text', category: 'LABORATORIO', description: 'Un espacio de prueba para las buenas ideas.' },
      { id: 'lab-inspiration', name: 'inspiración', kind: 'text', category: 'LABORATORIO', description: 'Referencias que nos hacen mirar dos veces.' },
      { id: 'lab-reviews', name: 'críticas', kind: 'text', category: 'LABORATORIO', description: 'Comparte tu proceso y recibe comentarios.' },
    ],
  },
  {
    id: 'open-source',
    name: 'Open Source',
    initials: 'os',
    color: '#E9BC73',
    description: 'Construir en abierto, aprender en comunidad.',
    channels: [
      { id: 'oss-general', name: 'general', kind: 'text', category: 'EN ABIERTO', description: 'Proyectos y personas que hacen el código abierto.' },
      { id: 'oss-help', name: 'ayuda', kind: 'text', category: 'EN ABIERTO', description: 'Toda contribución empieza con una pregunta.' },
      { id: 'oss-showcase', name: 'comparte-tu-proyecto', kind: 'text', category: 'EN ABIERTO', description: 'Enséñanos en qué estás trabajando.' },
    ],
  },
];

export const demoMembers: Member[] = [
  { id: 'you', name: 'Pablo', handle: 'pablo', initials: 'P', color: '#55D7AB', role: 'Creador', status: 'online', bio: 'Construyendo nu.vex, un píxel a la vez. Perfil de demostración.' },
  { id: 'elena', name: 'Elena', handle: 'elena.design', initials: 'E', color: '#B8A2EB', role: 'Diseño', status: 'online', bio: 'Interfaces tranquilas, ideas inquietas. Perfil de demostración.' },
  { id: 'marcos', name: 'Marcos', handle: 'marcos.dev', initials: 'M', color: '#E7B97F', role: 'Desarrollo', status: 'online', bio: 'Rust, café y código abierto. Perfil de demostración.' },
  { id: 'luna', name: 'Luna', handle: 'luna', initials: 'L', color: '#85B5E6', role: 'Comunidad', status: 'online', bio: 'Hagamos de internet un lugar más nuestro. Perfil de demostración.' },
  { id: 'alex', name: 'Álex', handle: 'alex', initials: 'Á', color: '#DB93AB', role: 'Colaborador', status: 'idle', bio: 'Probando ideas y documentando el camino. Perfil de demostración.' },
  { id: 'noa', name: 'Noa', handle: 'noa', initials: 'N', color: '#91BCAE', role: 'Colaborador', status: 'offline', bio: 'Accesibilidad y detalles pequeños. Perfil de demostración.' },
];

export const demoMessages: Message[] = [
  { id: 'demo-1', channelId: 'general', authorId: 'elena', content: 'Buenos días, equipo 🌿\nHe estado afinando la paleta. Ese verde oscuro con menta se siente muy nuestro.', createdAt: '2026-10-19T08:24:00.000Z', reactions: [{ emoji: '💚', count: 4 }] },
  { id: 'demo-2', channelId: 'general', authorId: 'marcos', content: 'Me encanta. Y que cada comunidad pueda darle su propio toque sin perder claridad.', createdAt: '2026-10-19T08:26:00.000Z' },
  { id: 'demo-3', channelId: 'general', authorId: 'luna', content: 'Justo eso: un espacio que sientas tuyo. ¿Probamos también una versión con menos transparencia?', createdAt: '2026-10-19T08:28:00.000Z' },
  { id: 'demo-4', channelId: 'general', authorId: 'you', content: 'Sí, está en Apariencia ✨\nPodéis ajustar el cristal, los colores y la densidad. La idea es que nu.vex se adapte a cada persona.', createdAt: '2026-10-19T08:31:00.000Z', reactions: [{ emoji: '✨', count: 3 }, { emoji: '🌱', count: 2 }] },
  { id: 'demo-5', channelId: 'general', authorId: 'elena', content: 'He dejado unas notas para la siguiente iteración. Menos ruido, más conversación.', createdAt: '2026-10-19T08:32:00.000Z', attachment: { name: 'notas-de-diseño.md', size: 2_048, mimeType: 'text/markdown' } },
  { id: 'demo-6', channelId: 'general', authorId: 'marcos', content: 'Paso a paso. Primero una buena base y después conectamos a dos personas de verdad. Esto ya empieza a sentirse como casa.', createdAt: '2026-10-19T08:35:00.000Z', reactions: [{ emoji: '🏡', count: 5 }] },
  { id: 'demo-welcome', channelId: 'welcome', authorId: 'you', content: 'Bienvenido a la demo local de nu.vex 🌱\nExplora los canales y prueba Apariencia. Los mensajes de esta sesión son temporales y aún no existe un servidor conectado.', createdAt: '2026-10-19T08:00:00.000Z' },
  { id: 'demo-announcement', channelId: 'announcements', authorId: 'you', content: 'Primer hito: identidad, navegación y sistema de temas. El siguiente paso será la mensajería persistente entre usuarios reales.', createdAt: '2026-10-19T08:05:00.000Z' },
  { id: 'demo-idea', channelId: 'ideas', authorId: 'luna', content: 'Me gustaría elegir qué paneles ver en pantallas pequeñas. La conversación siempre debería tener espacio.', createdAt: '2026-10-19T08:12:00.000Z' },
  { id: 'demo-dev', channelId: 'development', authorId: 'marcos', content: 'La base de esta demo separa los contratos y los temas de los componentes de interfaz. Aún no hay autenticación ni API.', createdAt: '2026-10-19T08:14:00.000Z' },
  { id: 'demo-design', channelId: 'design', authorId: 'elena', content: 'Pocos colores, mucho espacio y los píxeles originales de nuestra marca. El diseño también empieza por saber qué dejar fuera.', createdAt: '2026-10-19T08:16:00.000Z' },
  { id: 'demo-lab', channelId: 'lab-general', authorId: 'elena', content: 'Bienvenidos al laboratorio. Este es un segundo espacio de demostración para explorar la navegación entre comunidades.', createdAt: '2026-10-19T08:20:00.000Z' },
  { id: 'demo-oss', channelId: 'oss-general', authorId: 'marcos', content: 'Código abierto, decisiones documentadas y pequeñas contribuciones. Así queremos construir nu.vex.', createdAt: '2026-10-19T08:21:00.000Z' },
];
