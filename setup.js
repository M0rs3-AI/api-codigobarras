#!/usr/bin/env node
async function main() {
  const { intro, outro, text, password, select, confirm, spinner, isCancel, cancel } = await import('@clack/prompts');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const crypto = await import('node:crypto');

  intro('Bridge Código de Barras — Configuración inicial');

  const envExample = await fs.readFile(path.join(process.cwd(), '.env.example'), 'utf-8');
  const envVars = parseEnvExample(envExample);
  const values = {};

  for (const v of envVars) {
    const description = v.comments.join(' ') || `Valor para ${v.key}`;
    let result;

    switch (v.key) {
      case 'BRIDGE_TOKEN': {
        const generated = crypto.randomUUID();
        result = await text({
          message: `${description} (Enter para usar el generado)`,
          placeholder: 'Token aleatorio generado automáticamente',
          initialValue: generated,
          validate: (val) => {
            if (!val || val.length < 8) return 'Debe tener al menos 8 caracteres';
          },
        });
        break;
      }

      case 'NODE_ENV':
        result = await select({
          message: 'Entorno de ejecución',
          options: [
            { value: 'production', label: 'Producción', hint: 'recomendado' },
            { value: 'development', label: 'Desarrollo', hint: 'logs detallados' },
          ],
        });
        break;

      case 'SQL_PASSWORD':
        result = await password({
          message: description,
          placeholder: 'Contraseña del usuario SQL Server',
          validate: (val) => {
            if (!val) return 'La contraseña no puede estar vacía';
          },
        });
        break;

      case 'SQL_PORT':
        result = await text({
          message: description,
          placeholder: 'Ej: 1433, 1435',
          initialValue: v.defaultValue || '1433',
          validate: (val) => {
            if (val && isNaN(Number(val))) return 'Debe ser un número';
          },
        });
        break;

      case 'PORT':
        result = await text({
          message: description,
          placeholder: 'Ej: 3001',
          initialValue: v.defaultValue || '3001',
          validate: (val) => {
            if (!val || isNaN(Number(val))) return 'Debe ser un número';
          },
        });
        break;

      default:
        result = await text({
          message: description,
          placeholder: v.defaultValue || `Ingresa ${v.key}`,
          initialValue: v.defaultValue && !v.defaultValue.startsWith('xxxx') ? v.defaultValue : undefined,
        });
    }

    if (isCancel(result)) {
      cancel('Configuración cancelada. No se generó .env.');
      process.exit(0);
    }

    values[v.key] = result;
  }

  const s = spinner();
  s.start('Generando archivo .env');

  let output = `# Generado por setup.js el ${new Date().toLocaleString()}\n`;
  output += `# NO subas este archivo al repositorio — contiene credenciales reales.\n\n`;

  for (const v of envVars) {
    for (const c of v.comments) {
      output += `# ${c}\n`;
    }
    output += `${v.key}=${values[v.key]}\n\n`;
  }

  await fs.writeFile('.env', output.trimEnd() + '\n');

  s.stop('Archivo .env generado correctamente');
  outro('Configuración completada. El instalador continuará con el servicio.');
}

function parseEnvExample(content) {
  const lines = content.split('\n');
  const variables = [];
  let currentComments = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      const comment = trimmed.replace(/^#\s*/, '');
      currentComments.push(comment);
    } else if (trimmed.includes('=') && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      variables.push({ key, defaultValue: value, comments: [...currentComments] });
      currentComments = [];
    } else if (trimmed === '') {
      currentComments = [];
    }
  }

  return variables;
}

main().catch((err) => {
  console.error('Error en setup.js:', err.message);
  process.exit(1);
});
