type PostModule = {
  frontmatter: {
    title: string;
    published: string | Date;
  };
};

const modules = import.meta.glob<PostModule>("../pages/posts/*.mdx", {
  eager: true,
});

export const posts = Object.entries(modules)
  .map(([path, post]) => ({
    title: post.frontmatter.title,
    published: new Date(post.frontmatter.published),
    href: path.replace("../pages", "").replace(/\.mdx$/, ""),
  }))
  .sort((a, b) => b.published.getTime() - a.published.getTime());

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export const formatPostDate = (date: Date): string =>
  dateFormatter.format(date);
