import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Odesílání e-mailů přes SMTP (v dev Mailpit z docker-compose, UI na http://localhost:8025). */
@Injectable()
export class MailService {
  private transporter: Transporter | null = null;

  async send(message: MailMessage): Promise<void> {
    const { host, port, user, password } = config.smtp;
    this.transporter ??= nodemailer.createTransport({
      host,
      port,
      // 465 = TLS od začátku; ostatní porty (587) přejdou na TLS přes STARTTLS, umí-li to server.
      secure: port === 465,
      auth: user ? { user, pass: password } : undefined,
    });
    await this.transporter.sendMail({ from: config.smtp.from, ...message });
  }
}
