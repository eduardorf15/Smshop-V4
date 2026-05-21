export default {
  apps: [
    {
      name: "smshop-v4",
      script: "server/app.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        SITE_URL: "https://seudominio.com.br"
      },
      max_memory_restart: "300M",
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      time: true
    }
  ]
};
