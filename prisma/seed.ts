import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/* ── helpers ── */
function daysFromNow(d: number) {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  dt.setHours(10 + Math.floor(Math.random() * 10), [0, 30][Math.floor(Math.random() * 2)], 0, 0);
  return dt;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function slug() {
  return Math.random().toString(36).slice(2, 10);
}

/* ── mock data ── */
const TEACHERS = [
  {
    firstName: 'Priya',     lastName: 'Sharma',
    email: 'priya.sharma@example.com',
    title: 'Senior Data Scientist at Amazon',
    subject: 'Data Science',
    bio: 'I help professionals break into data science with practical, hands-on sessions. 8+ years at Amazon building ML pipelines at scale. I teach the fundamentals you actually need — not just theory.\n\nEvery session is live and free. My goal is to make data science accessible to everyone, regardless of background.',
    city: 'Bangalore', country: 'India',
    expertiseTags: JSON.stringify(['Python', 'Machine Learning', 'SQL', 'Data Visualization', 'Statistics', 'Pandas']),
    linkedinUrl: 'https://linkedin.com/in/priya-sharma',
    twitterUrl: 'https://twitter.com/priyasharma_ds',
    gender: 'Female',
  },
  {
    firstName: 'Rahul',     lastName: 'Verma',
    email: 'rahul.verma@example.com',
    title: 'Full Stack Engineer at Flipkart',
    subject: 'Web Development',
    bio: 'Full-stack developer with 7 years of experience building products used by millions. I specialise in React, Node.js, and system design.\n\nMy sessions focus on real-world problem solving — no toy examples. Join me to learn how production-grade systems are actually built.',
    city: 'Hyderabad', country: 'India',
    expertiseTags: JSON.stringify(['React', 'Node.js', 'TypeScript', 'System Design', 'PostgreSQL', 'Docker']),
    linkedinUrl: 'https://linkedin.com/in/rahul-verma-dev',
    websiteUrl: 'https://rahulverma.dev',
    gender: 'Male',
  },
  {
    firstName: 'Ananya',    lastName: 'Iyer',
    email: 'ananya.iyer@example.com',
    title: 'UX Lead at Microsoft',
    subject: 'UX / Product Design',
    bio: 'Designing user experiences for 9 years across fintech, edtech and enterprise software. Currently leading UX at Microsoft India.\n\nI teach design thinking, prototyping, and how to present your work to stakeholders effectively.',
    city: 'Pune', country: 'India',
    expertiseTags: JSON.stringify(['Figma', 'Design Thinking', 'User Research', 'Prototyping', 'Accessibility', 'Design Systems']),
    linkedinUrl: 'https://linkedin.com/in/ananya-iyer-ux',
    gender: 'Female',
  },
  {
    firstName: 'Arjun',     lastName: 'Nair',
    email: 'arjun.nair@example.com',
    title: 'DevOps Architect at Infosys',
    subject: 'DevOps & Cloud',
    bio: 'Cloud architect with AWS and GCP certifications. I have helped 50+ teams migrate to cloud-native infrastructure.\n\nMy sessions demystify Kubernetes, CI/CD pipelines, and cost-optimisation strategies that actually work in production.',
    city: 'Chennai', country: 'India',
    expertiseTags: JSON.stringify(['Kubernetes', 'AWS', 'Docker', 'Terraform', 'CI/CD', 'Linux', 'Monitoring']),
    linkedinUrl: 'https://linkedin.com/in/arjun-nair-devops',
    youtubeUrl: 'https://youtube.com/@arjunnair',
    gender: 'Male',
  },
  {
    firstName: 'Meera',     lastName: 'Pillai',
    email: 'meera.pillai@example.com',
    title: 'Product Manager at Razorpay',
    subject: 'Product Management',
    bio: 'PM at Razorpay with a background in engineering. I have shipped 12+ products across payments and lending.\n\nI teach the PM craft — from writing PRDs to stakeholder management and the metrics that matter.',
    city: 'Mumbai', country: 'India',
    expertiseTags: JSON.stringify(['Product Strategy', 'Roadmapping', 'User Stories', 'OKRs', 'A/B Testing', 'Agile']),
    linkedinUrl: 'https://linkedin.com/in/meera-pillai-pm',
    twitterUrl: 'https://twitter.com/meerapm',
    gender: 'Female',
  },
  {
    firstName: 'Karthik',   lastName: 'Raj',
    email: 'karthik.raj@example.com',
    title: 'Quant Researcher at Goldman Sachs',
    subject: 'Finance & Algo Trading',
    bio: 'Quantitative researcher with 10 years in algorithmic trading. I bridge the gap between finance theory and practical implementation in Python.\n\nMy sessions cover backtesting, risk management, and building your first trading strategy.',
    city: 'Delhi', country: 'India',
    expertiseTags: JSON.stringify(['Algo Trading', 'Python', 'Quantitative Finance', 'Risk Management', 'Statistics', 'Backtesting']),
    linkedinUrl: 'https://linkedin.com/in/karthik-raj-quant',
    websiteUrl: 'https://karthikraj.io',
    gender: 'Male',
  },
  {
    firstName: 'Divya',     lastName: 'Menon',
    email: 'divya.menon@example.com',
    title: 'Android Lead at Swiggy',
    subject: 'Mobile Development',
    bio: 'Android developer for 8 years, currently leading mobile engineering at Swiggy. I have built apps with 10M+ downloads.\n\nI teach Kotlin, Jetpack Compose, and how to optimise for performance and battery life on real devices.',
    city: 'Bangalore', country: 'India',
    expertiseTags: JSON.stringify(['Android', 'Kotlin', 'Jetpack Compose', 'Mobile Architecture', 'Firebase', 'Testing']),
    linkedinUrl: 'https://linkedin.com/in/divya-menon-android',
    youtubeUrl: 'https://youtube.com/@divyamenon',
    gender: 'Female',
  },
  {
    firstName: 'Vikram',    lastName: 'Singh',
    email: 'vikram.singh@example.com',
    title: 'Cybersecurity Consultant',
    subject: 'Cybersecurity',
    bio: 'Independent security consultant with OSCP and CEH certifications. Previously at PwC and Deloitte.\n\nI run practical, hands-on sessions on ethical hacking, web security, and building secure systems from the ground up.',
    city: 'Noida', country: 'India',
    expertiseTags: JSON.stringify(['Ethical Hacking', 'Web Security', 'Penetration Testing', 'OWASP', 'Network Security', 'CTF']),
    linkedinUrl: 'https://linkedin.com/in/vikram-singh-sec',
    websiteUrl: 'https://vikramsingh.sec',
    gender: 'Male',
  },
];

const SESSION_TEMPLATES = [
  // Data Science
  { type: 'webinar',   title: 'Python for Data Science: Pandas Masterclass',           category: 'Data Science',    duration: 60, skillLevel: 'beginner' },
  { type: 'liveclass', title: 'Machine Learning from Scratch',                          category: 'Data Science',    duration: 90, skillLevel: 'intermediate' },
  { type: 'webinar',   title: 'SQL for Analysts: Window Functions Deep Dive',           category: 'Data Science',    duration: 45, skillLevel: 'intermediate' },
  { type: 'liveclass', title: 'Building Your First ML Model End-to-End',               category: 'Data Science',    duration: 120, skillLevel: 'beginner' },
  // Web Dev
  { type: 'liveclass', title: 'React 18: Concurrent Features in Practice',             category: 'Web Development', duration: 90, skillLevel: 'intermediate' },
  { type: 'webinar',   title: 'Node.js Performance Optimisation',                       category: 'Web Development', duration: 60, skillLevel: 'advanced' },
  { type: 'liveclass', title: 'TypeScript Generics: Stop Being Afraid',                category: 'Web Development', duration: 75, skillLevel: 'intermediate' },
  { type: 'webinar',   title: 'System Design: Building Scalable APIs',                 category: 'Web Development', duration: 90, skillLevel: 'advanced' },
  // UX
  { type: 'liveclass', title: 'Design Thinking Workshop: From Problem to Prototype',   category: 'UX Design',       duration: 120, skillLevel: 'beginner' },
  { type: 'webinar',   title: 'Figma Auto Layout Masterclass',                         category: 'UX Design',       duration: 60, skillLevel: 'intermediate' },
  { type: 'liveclass', title: 'User Research: Interviews That Actually Work',          category: 'UX Design',       duration: 90, skillLevel: 'beginner' },
  // DevOps
  { type: 'liveclass', title: 'Kubernetes for Developers: Zero to Deployed',           category: 'DevOps',          duration: 120, skillLevel: 'intermediate' },
  { type: 'webinar',   title: 'Terraform: Infrastructure as Code in 60 Minutes',      category: 'DevOps',          duration: 60, skillLevel: 'intermediate' },
  { type: 'liveclass', title: 'CI/CD Pipelines with GitHub Actions',                  category: 'DevOps',          duration: 90, skillLevel: 'beginner' },
  // PM
  { type: 'webinar',   title: 'Writing PRDs That Engineers Actually Read',             category: 'Product',         duration: 60, skillLevel: 'beginner' },
  { type: 'liveclass', title: 'OKRs in Practice: Setting Goals That Stick',           category: 'Product',         duration: 75, skillLevel: 'intermediate' },
  { type: 'webinar',   title: 'Product Analytics: Metrics That Matter',               category: 'Product',         duration: 60, skillLevel: 'beginner' },
  // Finance
  { type: 'liveclass', title: 'Build Your First Algo Trading Strategy in Python',     category: 'Finance',         duration: 120, skillLevel: 'intermediate' },
  { type: 'webinar',   title: 'Quantitative Risk Management Fundamentals',            category: 'Finance',         duration: 60, skillLevel: 'advanced' },
  // Mobile
  { type: 'liveclass', title: 'Jetpack Compose: Build a Real App from Scratch',      category: 'Mobile',          duration: 120, skillLevel: 'intermediate' },
  { type: 'webinar',   title: 'Android Performance: Smooth Scrolling & Memory',      category: 'Mobile',          duration: 60, skillLevel: 'advanced' },
  // Security
  { type: 'liveclass', title: 'Ethical Hacking: Your First Penetration Test',        category: 'Security',        duration: 120, skillLevel: 'beginner' },
  { type: 'webinar',   title: 'OWASP Top 10: Every Developer Should Know This',      category: 'Security',        duration: 75, skillLevel: 'beginner' },
];

const BANNER_COLORS = [
  '#1d6b3c', '#1a4f7a', '#c45b2a', '#7c3aed', '#0e6370',
  '#9b2c4e', '#854d0e', '#1e3a5f', '#166534', '#7e22ce',
];

async function main() {
  const password = await bcrypt.hash('87654321', 10);

  console.log('🌱 Seeding database...\n');

  for (const teacher of TEACHERS) {
    /* upsert user */
    const user = await prisma.user.upsert({
      where: { email: teacher.email },
      update: {},
      create: {
        email:       teacher.email,
        name:        `${teacher.firstName} ${teacher.lastName}`,
        firstName:   teacher.firstName,
        lastName:    teacher.lastName,
        password,
        verified:    true,
        gender:      teacher.gender,
        title:       teacher.title,
        subject:     teacher.subject,
        bio:         teacher.bio,
        city:        teacher.city,
        country:     teacher.country,
        expertiseTags: teacher.expertiseTags,
        linkedinUrl: teacher.linkedinUrl  ?? null,
        twitterUrl:  teacher.twitterUrl   ?? null,
        websiteUrl:  teacher.websiteUrl   ?? null,
        youtubeUrl:  teacher.youtubeUrl   ?? null,
        profilePublic: true,
      },
    });

    /* pick 7-9 unique session templates for this teacher */
    const shuffled = [...SESSION_TEMPLATES].sort(() => Math.random() - 0.5);
    const chosen   = shuffled.slice(0, 7 + Math.floor(Math.random() * 3)); // 7-9

    const now = new Date();
    let upcomingCount = 0;

    for (let i = 0; i < chosen.length; i++) {
      const tpl = chosen[i];
      /* first 3-4 are upcoming, rest are completed */
      const maxUpcoming = 3 + Math.floor(Math.random() * 2);
      const isUpcoming  = upcomingCount < maxUpcoming;

      const scheduledAt = isUpcoming
        ? daysFromNow(5 + i * 7)           // spread upcoming over next few weeks
        : daysFromNow(-(30 + i * 12));     // spread completed into the past

      if (isUpcoming) upcomingCount++;

      await prisma.session.create({
        data: {
          userId:        user.id,
          type:          tpl.type,
          title:         tpl.title,
          description:   `A focused ${tpl.duration}-minute ${tpl.type === 'webinar' ? 'webinar' : 'live class'} on ${tpl.title.toLowerCase()}. Practical, example-driven, and open to all skill levels.`,
          category:      tpl.category,
          skillLevel:    tpl.skillLevel,
          bannerColor:   pick(BANNER_COLORS),
          scheduledAt,
          duration:      tpl.duration,
          visibility:    'public',
          chatEnabled:   true,
          autoRecording: true,
          requireApproval: false,
          sendReminder:  true,
          status:        'published',
          approved:      true,
          inviteSlug:    slug(),
          tags:          teacher.expertiseTags,
        },
      });
    }

    console.log(`  ✅ ${teacher.firstName} ${teacher.lastName} — ${chosen.length} sessions (${upcomingCount} upcoming, ${chosen.length - upcomingCount} completed)`);
  }

  console.log(`\n✨ Done! ${TEACHERS.length} teachers seeded.\n`);
  console.log('Login with any teacher email above, password: 54321');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
