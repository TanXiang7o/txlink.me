interface Project {
  title: string
  description: string
  href?: string
  imgSrc?: string
}

const projectsData: Project[] = [
  {
    title: 'SaaS shortLink platform',
    description: `This is a SaaS short link system designed for enterprise and individual users, providing an efficient, safe and reliable short link management platform. It simplifies long links
    Management and sharing, with in-depth analysis and tracking functions, allowing users to flexibly manage and optimize links, thereby improving marketing effectiveness and business results.`,
    imgSrc: '/static/images/SaaS-shortLink.png',
    href: 'http://101.126.23.243/',
  },
]

export default projectsData
