require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  EmbedBuilder,
} = require("discord.js");

console.log("✅ BOT VERSION: CV Application v1");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, // for listening to uploads in threads
  ],
  partials: [Partials.Channel],
});

// In-memory state (ok for your use-case; resets if bot restarts)
const applications = new Map(); // userId -> { page1, page2, threadId, uploads: { buletinUrl, idUrl } }

// Helpers
function mustEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const TOKEN = mustEnv("TOKEN");
const CLIENT_ID = mustEnv("CLIENT_ID");
const GUILD_ID = mustEnv("GUILD_ID");
const APPLICATION_CHANNEL_ID = mustEnv("APPLICATION_CHANNEL_ID");
const REVIEW_CHANNEL_ID = mustEnv("REVIEW_CHANNEL_ID");

function getDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user.username;
}

function makePanel() {
  const btn = new ButtonBuilder()
    .setCustomId("cv_start")
    .setLabel("Depune CV")
    .setStyle(ButtonStyle.Success);

  return {
    content: "", // no extra text
    components: [new ActionRowBuilder().addComponents(btn)],
  };
}

function buildPage1Modal() {
  // 5 fields max
  return new ModalBuilder()
    .setCustomId("cv_page1")
    .setTitle("Depunere CV (Pagina 1/2)")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("nume_prenume")
          .setLabel("Nume + Prenume")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("iban")
          .setLabel("IBAN")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("luni_oras")
          .setLabel("Luni în oraș")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("telefon")
          .setLabel("Număr de telefon")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("cine_te_a_adus")
          .setLabel("Cine te-a adus?")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function buildPage2Modal() {
  // remaining text fields
  return new ModalBuilder()
    .setCustomId("cv_page2")
    .setTitle("Depunere CV (Pagina 2/2)")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("motiv")
          .setLabel("De ce vrei să te alături echipei noastre?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("experienta")
          .setLabel("Experiență anterioară")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );
}

async function postToReviewChannel({ applicantTag, applicantId, displayName, page1, page2, uploads, threadUrl }) {
  const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
  if (!reviewChannel || !reviewChannel.isTextBased()) {
    console.error("❌ REVIEW_CHANNEL_ID invalid");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("📄 CV Nou Depus")
    .addFields(
      { name: "Nume + Prenume", value: page1.nume_prenume || "—", inline: false },
      { name: "IBAN", value: page1.iban || "—", inline: false },
      { name: "Luni în oraș", value: page1.luni_oras || "—", inline: false },
      { name: "Număr de telefon", value: page1.telefon || "—", inline: false },
      { name: "Cine te-a adus?", value: page1.cine_te_a_adus || "—", inline: false },
      { name: "De ce vrei să te alături echipei noastre?", value: page2.motiv || "—", inline: false },
      { name: "Experiență anterioară", value: page2.experienta || "—", inline: false },
      { name: "Poză buletin + față", value: uploads.buletinUrl ? uploads.buletinUrl : "❌ Nu a fost încărcată", inline: false },
    )
    .setTimestamp(new Date());
if (uploads.buletinUrl) {
  embed.setImage(uploads.buletinUrl);
}
  await reviewChannel.send({ embeds: [embed] });
}

async function createPrivateThreadForUser(applicationChannel, user) {
  // Create a private thread and add the user
  const threadName = `cv-${user.username}-${String(Date.now()).slice(-4)}`.toLowerCase();

  const thread = await applicationChannel.threads.create({
    name: threadName,
    autoArchiveDuration: 1440, // 24h
    type: 12, // ChannelType.PrivateThread (numeric avoids import)
    reason: "CV Upload Thread",
  });

  await thread.members.add(user.id);

  await thread.send(
    [
      "📸 **Încarcă aici, te rog, două poze (în două mesaje separate sau în același mesaj):**",
      "1) **Poză buletin (față)**",
      "2) **Poză cu ID in-game + fața personajului**",
      "",
      "După ce sunt încărcate ambele, aplicația se trimite automat către staff în #Documente.",
    ].join("\n")
  );

  return thread;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("setup-cv")
      .setDescription("Postează/actualizează panoul de Depunere CV în canalul setat.")
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ Slash commands registered.");
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // /setup-cv -> posts the panel in Depunere CV
    if (interaction.isChatInputCommand() && interaction.commandName === "setup-cv") {
      const ch = await client.channels.fetch(APPLICATION_CHANNEL_ID).catch(() => null);
      if (!ch || !ch.isTextBased()) {
        return interaction.reply({ content: "❌ APPLICATION_CHANNEL_ID invalid.", ephemeral: true });
      }

      await ch.send(makePanel());
      return interaction.reply({ content: "✅ Panoul „Depune CV” a fost postat.", ephemeral: true });
    }

    // Button: start CV
    if (interaction.isButton() && interaction.customId === "cv_start") {
      // Reset any previous attempt
      applications.set(interaction.user.id, {
        page1: {},
        page2: {},
        threadId: null,
        uploads: { buletinUrl: null, idUrl: null },
      });

      return await interaction.showModal(buildPage1Modal());
    }

    // Modal submit: page 1
    if (interaction.isModalSubmit() && interaction.customId === "cv_page1") {
      const state = applications.get(interaction.user.id) || {
        page1: {},
        page2: {},
        threadId: null,
        uploads: { buletinUrl: null, idUrl: null },
      };

      state.page1 = {
        nume_prenume: interaction.fields.getTextInputValue("nume_prenume"),
        iban: interaction.fields.getTextInputValue("iban"),
        luni_oras: interaction.fields.getTextInputValue("luni_oras"),
        telefon: interaction.fields.getTextInputValue("telefon"),
        cine_te_a_adus: interaction.fields.getTextInputValue("cine_te_a_adus"),
      };

      applications.set(interaction.user.id, state);

      const nextBtn = new ButtonBuilder()
        .setCustomId("cv_next")
        .setLabel("Următoarea pagină")
        .setStyle(ButtonStyle.Primary);

      return interaction.reply({
        content: "✅ Pagina 1 a fost salvată.",
        components: [new ActionRowBuilder().addComponents(nextBtn)],
        ephemeral: true,
      });
    }

    // Button: next page -> open modal page 2
    if (interaction.isButton() && interaction.customId === "cv_next") {
      const state = applications.get(interaction.user.id);
      if (!state || !state.page1?.nume_prenume) {
        return interaction.reply({
          content: "❌ Nu am găsit datele din Pagina 1. Apasă din nou „Depune CV”.",
          ephemeral: true,
        });
      }
      return await interaction.showModal(buildPage2Modal());
    }

    // Modal submit: page 2 -> create private thread and ask for uploads
    if (interaction.isModalSubmit() && interaction.customId === "cv_page2") {
      const state = applications.get(interaction.user.id);
      if (!state || !state.page1?.nume_prenume) {
        return interaction.reply({
          content: "❌ Nu am găsit datele din Pagina 1. Apasă din nou „Depune CV”.",
          ephemeral: true,
        });
      }

      state.page2 = {
        motiv: interaction.fields.getTextInputValue("motiv"),
        experienta: interaction.fields.getTextInputValue("experienta"),
      };

      const applicationChannel = await client.channels.fetch(APPLICATION_CHANNEL_ID).catch(() => null);
      if (!applicationChannel || !applicationChannel.isTextBased()) {
        return interaction.reply({ content: "❌ APPLICATION_CHANNEL_ID invalid.", ephemeral: true });
      }

      // Create private thread (uploads happen there)
      const thread = await createPrivateThreadForUser(applicationChannel, interaction.user);
      state.threadId = thread.id;
      applications.set(interaction.user.id, state);

      return interaction.reply({
        content: `✅ Pagina 2 a fost salvată. Am creat un thread privat pentru poze: <#${thread.id}>`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error("❌ Interaction error:", err);
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: "❌ A apărut o eroare. Mai încearcă o dată.", ephemeral: true });
      }
    } catch {}
  }
});

// Listen for image uploads inside the private thread
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    const state = applications.get(message.author.id);
    if (!state?.threadId) return;
    if (message.channel.id !== state.threadId) return;

    // Collect attachment URLs (images)
    const attachments = Array.from(message.attachments.values());
    if (attachments.length === 0) return;

    // Put first attachment as buletin if missing, second as id if missing
    for (const att of attachments) {
      const url = att.url;
      if (!state.uploads.buletinUrl) {
        state.uploads.buletinUrl = url;
      } else if (!state.uploads.idUrl) {
        state.uploads.idUrl = url;
      }
    }

    applications.set(message.author.id, state);

    // Notify user progress in thread (no spam elsewhere)
    if (state.uploads.buletinUrl && state.uploads.idUrl) {
      await message.channel.send("✅ Am primit ambele poze. Trimit aplicația către staff în #Documente...");
      // Post to review channel
      const threadUrl = `https://discord.com/channels/${message.guildId}/${state.threadId}`;
      await postToReviewChannel({
        applicantTag: message.author.tag,
        applicantId: message.author.id,
        displayName: message.member?.displayName || message.author.username,
        page1: state.page1,
        page2: state.page2,
        uploads: state.uploads,
        threadUrl,
      });

      // Archive + lock thread
      try {
        await message.channel.setLocked(true);
        await message.channel.setArchived(true);
      } catch {}

      // Clear state
      applications.delete(message.author.id);
    } else {
      const status = [
        state.uploads.buletinUrl ? "✅ Buletin primit" : "⏳ Aștept buletin (față)",
        state.uploads.idUrl ? "✅ Poză ID in-game primită" : "⏳ Aștept poză ID in-game + față",
      ].join("\n");
      await message.channel.send(status);
    }
  } catch (err) {
    console.error("❌ MessageCreate error:", err);
  }
});

client.login(TOKEN);
