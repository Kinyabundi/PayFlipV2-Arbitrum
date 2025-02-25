import MyProducts from "@/app/app/_components/MyProducts";
import { Metadata } from "next";

export const metadata: Metadata = {
	title: "Products",
};

export default function page() {
	return <MyProducts />;
}