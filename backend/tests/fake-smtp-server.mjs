import net from "node:net";
import fs from "node:fs";

const port = Number(process.env.FAKE_SMTP_PORT || 2525);
const output = process.env.FAKE_SMTP_OUTPUT || "/tmp/cardoria-reset-email.eml";

const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  socket.write("220 cardoria-test-smtp ESMTP\r\n");

  let buffer = "";
  let inData = false;
  let message = "";

  function reply(line) {
    socket.write(line + "\r\n");
  }

  function handleLine(line) {
    if (inData) {
      if (line === ".") {
        fs.writeFileSync(output, message, "utf8");
        message = "";
        inData = false;
        reply("250 2.0.0 queued");
        return;
      }
      message += line + "\r\n";
      return;
    }

    const upper = line.toUpperCase();
    if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
      socket.write("250-cardoria-test-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 10485760\r\n");
      return;
    }
    if (upper.startsWith("AUTH PLAIN")) return reply("235 2.7.0 Authentication successful");
    if (upper === "AUTH LOGIN") return reply("334 VXNlcm5hbWU6");
    if (upper === "DXNLCG" || upper === "DGVZDA==" || upper === "DGVZDDP0ZXN0") return reply("235 2.7.0 Authentication successful");
    if (upper.startsWith("MAIL FROM:")) return reply("250 2.1.0 Ok");
    if (upper.startsWith("RCPT TO:")) return reply("250 2.1.5 Ok");
    if (upper === "DATA") {
      inData = true;
      message = "";
      return reply("354 End data with <CR><LF>.<CR><LF>");
    }
    if (upper === "RSET" || upper === "NOOP") return reply("250 2.0.0 Ok");
    if (upper === "QUIT") {
      reply("221 2.0.0 Bye");
      socket.end();
      return;
    }
    reply("250 2.0.0 Ok");
  }

  socket.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\r\n")) {
      const index = buffer.indexOf("\r\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      handleLine(line);
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake SMTP listening on 127.0.0.1:${port}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
