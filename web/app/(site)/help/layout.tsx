import ForceLight from "@/components/ForceLight";

// The whole help centre is white, the same as the landing page and pricing:
// it is read by people who have not signed up yet, often straight from a
// search result, and it should look like the same company as the page that
// sent them. One layout rather than the same line in three page files.
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ForceLight />
      {children}
    </>
  );
}
