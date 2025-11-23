// Build Version and API Base URL
window.SMARTQUIZ_BUILD_VERSION = "2025-11-14-a";
const isLocal =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
window.SMARTQUIZ_API_BASE_URL = isLocal ? "http://localhost:8000/api" : null;

// Mobile Navigation Menu
const openMenu = document.getElementById("open-menu");
const closeMenu = document.getElementById("close-menu");
const navlinks = document.getElementById("mobile-navlinks");

const openMenuHandler = () => {
  navlinks.classList.remove("-translate-x-full");
  navlinks.classList.add("translate-x-0");
};

const closeMenuHandler = () => {
  navlinks.classList.remove("translate-x-0");
  navlinks.classList.add("-translate-x-full");
};

openMenu.addEventListener("click", openMenuHandler);
closeMenu.addEventListener("click", closeMenuHandler);

// Trusted Brands Marquee
const institutions = [
  {
    name: "Harvard",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Harvard_University_logo.svg/600px-Harvard_University_logo.svg.png?20240103220517",
  },
  {
    name: "UP",
    url: "https://uplb.edu.ph/wp-content/uploads/2021/09/UPLB-VIG-HR-Maroon.png",
  },
  {
    name: "MIT",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/MIT_Logo_and_Wordmark.svg/2560px-MIT_Logo_and_Wordmark.svg.png",
  },
  {
    name: "Ateneo",
    url: "https://www.ateneo.edu/sites/default/files/styles/large/public/2025-07/Ateneo-WEB-informal-horizontal-colored.png?itok=tSEr0MSp",
  },
  {
    name: "Stanford",
    url: "https://drupalprodblob.blob.core.windows.net/stanford/branding/stanford-university-logo_1.png",
  },
  {
    name: "DLSU",
    url: "https://www.dlsu.edu.ph/wp-content/uploads/2017/10/dlsu-logo-green.png",
  },
  {
    name: "Oxford",
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/University_of_Oxford.svg/2560px-University_of_Oxford.svg.png",
  },
  {
    name: "UST",
    url: "https://www.ust.edu.ph/wp-content/uploads/2023/09/7dc67d16-3374-43f2-a9c5-27d73d139d86-1024x243.png",
  },
  {
    name: "Cambridge",
    url: "https://upload.wikimedia.org/wikipedia/commons/4/4d/University_of_Cambridge_logo.png",
  },
];

const marqueeContainer = document.getElementById("logo-marquee");

const allInstitutions = [...institutions, ...institutions];

marqueeContainer.innerHTML = allInstitutions
  .map(
    (school) => `
  <img 
    class="mx-11 h-12 w-auto opacity-60 hover:opacity-100 transition grayscale invert" 
    src="${school.url}" 
    alt="${school.name}" 
  />
`
  )
  .join("");

// Features Section
const features = [
  {
    title: "Automated Generation",
    description:
      "Instantly parse your PDF documents to identify key concepts and generate relevant questions in seconds.",
    image: "https://placehold.co/1920x1080", // Replace with your actual image path later
  },
  {
    title: "Save & Review",
    description:
      "Log in to save your quiz history, allowing you to revisit past questions and track your study progress.",
    image: "https://placehold.co/1920x1080",
  },
  {
    title: "Distraction-Free",
    description:
      "A clean, clutter-free interface designed to help you focus purely on the content without unnecessary noise.",
    image: "https://placehold.co/1920x1080",
  },
];

// Avatar Stack Section
const avatars = [
  "https://images.unsplash.com/photo-1633332755192-727a05c4013d?q=80&w=200",
  "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=200",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?q=80&w=200&h=200&auto=format&fit=crop",
  "https://randomuser.me/api/portraits/men/75.jpg",
];

const avatarStack = document.getElementById("avatar-stack");

avatarStack.innerHTML = avatars
  .map(
    (url, index) => `
  <img
    src="${url}"
    alt="User"
    class="size-7 rounded-full border-2 border-white hover:-translate-y-0.5 transition relative"
    style="z-index: ${index}" 
  />
`
  )
  .join("");

// Render Features
const featuresGrid = document.getElementById("features-grid");

featuresGrid.innerHTML = features
  .map(
    (feature) => `
  <div class="max-w-80 hover:-translate-y-0.5 transition duration-300 group">
    <img class="rounded-xl mb-4" src="${feature.image}" alt="${feature.title}" />
    <h3 class="text-base font-semibold text-white">
      ${feature.title}
    </h3>
    <p class="text-sm text-slate-400 mt-1">
      ${feature.description}
    </p>
  </div>
`
  )
  .join("");

// How It Works Section
const steps = [
  {
    icon: "cloud-upload-outline",
    title: "Upload Your PDF",
    desc: "Simply select your study material. The system accepts PDF files and prepares them for immediate processing.",
  },
  {
    icon: "flash-outline",
    title: "AI Generation",
    desc: "Gemini AI scans your document, extracting key concepts to formulate accurate multiple-choice questions.",
  },
  {
    icon: "checkmark-circle-outline",
    title: "Test & Review",
    desc: "Take the quiz immediately in our clean interface to reinforce your learning, with instant scoring and feedback.",
  },
];

const stepsContainer = document.getElementById("how-it-works-grid");

stepsContainer.innerHTML = steps
  .map(
    (step) => `
  <div class="flex flex-col items-center justify-center max-w-80 group">
    <div class="p-6 aspect-square bg-purple-600 rounded-full grid place-items-center shadow-lg shadow-purple-900/20 group-hover:scale-110 transition duration-300">
      <ion-icon
        name="${step.icon}"
        size="large"
        class="text-white"
      ></ion-icon>
    </div>
    <div class="mt-5 space-y-2 text-center">
      <h3 class="text-base font-semibold text-white">${step.title}</h3>
      <p class="text-sm text-slate-400 leading-relaxed">
        ${step.desc}
      </p>
    </div>
  </div>
`
  )
  .join("");

// Testimonials Section
const testimonials = [
  {
    text: "I threw my 30-page history syllabus in here an hour before the exam. It actually found the specific dates I needed to know. Saved my GPA.",
    initial: "A",
    name: "Alex M.",
    role: "University Student",
    color: "purple",
  },
  {
    text: "Usually, writing quiz questions takes me longer than grading them. SmartQuiz cuts that time down to seconds. It captures the nuance of my lecture slides perfectly.",
    initial: "D",
    name: "Prof. David H.",
    role: "History Professor",
    color: "blue",
  },
  {
    text: "As a nursing student, the amount of reading is insane. Converting my textbooks into active quizzes helps me retain way more than just highlighting text.",
    initial: "S",
    name: "Sarah K.",
    role: "Nursing Student",
    color: "green",
  },
  {
    text: "The distraction-free mode is a game changer. No ads, no sidebar nonsense. Just me and the questions. I use it for every subject now.",
    initial: "J",
    name: "James L.",
    role: "High School Senior",
    color: "pink",
  },
  {
    text: "I use this to generate 'exit tickets' for my classes. I upload the day's reading, get 5 questions, and we're done. Highly recommend for educators.",
    initial: "E",
    name: "Elena R.",
    role: "High School Teacher",
    color: "orange",
  },
  {
    text: "I was skeptical that AI could understand my coding documentation, but it generated valid multiple-choice questions about React hooks from the docs.",
    initial: "M",
    name: "Michael T.",
    role: "CS Student",
    color: "cyan",
  },
];

const grid = document.getElementById("testimonials-grid");

grid.innerHTML = testimonials
  .map(
    (item) => `
  <div class="bg-[#11121E] border border-gray-800 p-8 rounded-2xl hover:border-purple-500/50 transition duration-300 flex flex-col">
    
    <div class="flex text-yellow-500 mb-4 gap-1">
      <ion-icon name="star"></ion-icon>
      <ion-icon name="star"></ion-icon>
      <ion-icon name="star"></ion-icon>
      <ion-icon name="star"></ion-icon>
      <ion-icon name="star"></ion-icon>
    </div>

    <p class="text-gray-300 mb-6 flex-grow">"${item.text}"</p>

    <div class="flex items-center gap-3 mt-auto">
      <div class="w-10 h-10 bg-${item.color}-600/20 rounded-full grid place-items-center text-${item.color}-400 font-bold">
        ${item.initial}
      </div>
      <div>
        <div class="text-white font-medium">${item.name}</div>
        <div class="text-gray-500 text-sm">${item.role}</div>
      </div>
    </div>
  </div>
`
  )
  .join("");

// FAQ Section
const faqs = [
  {
    question: "What file formats do you support?",
    answer:
      "Currently, we strictly support PDF documents, including textbooks, lecture slides, and meeting notes. We are working on adding support for Word (.docx) and plain text files in the future.",
  },
  {
    question: "Is SmartQuiz free to use?",
    answer:
      "Yes! You can generate quizzes as a Guest completely free of charge. If you wish to save your quiz history and track your progress over time, you can log in with your Google account.",
  },
  {
    question: "How accurate are the generated questions?",
    answer:
      "We use advanced AI (Google Gemini) to analyze your document's context. While the accuracy is very high, we always recommend reviewing the generated questions and answers before your final exam prep.",
  },
  {
    question: "Is there a limit on file size or page count?",
    answer:
      "For the best performance, we recommend uploading PDFs under 10MB or roughly 50-100 pages. If you have a large textbook, try splitting it into individual chapters for more focused quizzes.",
  },
  {
    question: "How long does it take to generate a quiz?",
    answer:
      "It's extremely fast. Most documents are processed in under 15 seconds. Larger files (over 50 pages) may take up to a minute depending on the complexity of the content.",
  },
  {
    question: "What happens if the AI makes a mistake?",
    answer:
      "While AI is powerful, it's not perfect. We currently generate questions 'as-is', but we are working on a feature that will allow you to edit or delete specific questions before starting the quiz.",
  },
];

const container = document.getElementById("faqContainer");
container.className = "w-full";

faqs.forEach((faq, index) => {
  const wrapper = document.createElement("div");
  wrapper.className = "border-b border-slate-800 py-4 cursor-pointer w-full";

  const header = document.createElement("div");
  header.className = "flex items-center justify-between";
  header.innerHTML = `
        <h3 class="text-base font-medium text-white">${faq.question}</h3>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="transition-all duration-500 ease-in-out icon">
            <path d="m4.5 7.2 3.793 3.793a1 1 0 0 0 1.414 0L13.5 7.2"
                stroke="#1D293D" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

  const answer = document.createElement("p");
  answer.className =
    "text-sm text-slate-400 transition-all duration-500 ease-in-out max-w-3xl opacity-0 max-h-0 -translate-y-2 pt-0 answer";
  answer.textContent = faq.answer;

  wrapper.appendChild(header);
  wrapper.appendChild(answer);
  container.appendChild(wrapper);

  header.addEventListener("click", () => {
    const allAnswers = document.querySelectorAll(".answer");
    const allIcons = document.querySelectorAll(".icon");

    allAnswers.forEach((el, i) => {
      if (i === index) {
        const isOpen = el.classList.contains("opacity-100");
        el.classList.toggle("opacity-100", !isOpen);
        el.classList.toggle("max-h-[300px]", !isOpen);
        el.classList.toggle("translate-y-0", !isOpen);
        el.classList.toggle("pt-4", !isOpen);
        el.classList.toggle("opacity-0", isOpen);
        el.classList.toggle("max-h-0", isOpen);
        el.classList.toggle("-translate-y-2", isOpen);

        allIcons[i].classList.toggle("rotate-180", !isOpen);
      } else {
        el.classList.remove(
          "opacity-100",
          "max-h-[300px]",
          "translate-y-0",
          "pt-4"
        );
        el.classList.add("opacity-0", "max-h-0", "-translate-y-2");
        allIcons[i].classList.remove("rotate-180");
      }
    });
  });
});
