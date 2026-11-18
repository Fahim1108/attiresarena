/**
 * Bangladesh administrative locations for the checkout address form.
 *
 * Divisions and all 64 districts are complete, and every district now has
 * an area/upazila list, so the address form always shows an Area / Upazila
 * select (never a free-text field). Option values stay in English: the
 * checkout RPC and the courier booking read the same strings.
 *
 * Source for the 59 added districts: the published division/district/upazila
 * dataset at https://gist.github.com/fsuuaas/fd5c3b079244c4ab2c4a8b1500a7e32d
 * (division -> district -> upazila JSON). Spellings follow that dataset,
 * with four documented adjustments:
 *  - District keys mapped to this file's division table: the dataset's
 *    "Nawabganj" is "Chapai Nawabganj" and its "Jhenaida" is "Jhenaidah".
 *  - "Manikgonj Sadar" corrected to "Manikganj Sadar" (the dataset's own
 *    district spelling).
 *  - "Tanore" added to Rajshahi (missing from the dataset; Rajshahi has
 *    nine upazilas).
 *  - Five upazilas approved in May 2026 added: Mokamtola (Bogura),
 *    Matamuhuri (Cox's Bazar), Chandraganj (Lakshmipur), Ruhia and Bhully
 *    (Thakurgaon).
 * Added lists are sorted A-Z. The three pre-existing lists Dhaka,
 * Gazipur and Narayanganj are kept byte-identical: they mix city thanas
 * with upazilas and already cover the dataset's entries. Chattogram and
 * Sylhet keep every pre-existing entry and gain the dataset's missing
 * upazilas (a union), because their old lists were thana-heavy and
 * incomplete — with the free-text fallback removed, customers in the
 * missing upazilas would otherwise have no correct area to pick. The
 * union keeps the app's "Companiganj" spelling, not the dataset's
 * "Companigonj" variant.
 */
export const DIVISIONS: Record<string, string[]> = {
  Dhaka: ["Dhaka", "Faridpur", "Gazipur", "Gopalganj", "Kishoreganj", "Madaripur", "Manikganj", "Munshiganj", "Narayanganj", "Narsingdi", "Rajbari", "Shariatpur", "Tangail"],
  Chattogram: ["Bandarban", "Brahmanbaria", "Chandpur", "Chattogram", "Cox's Bazar", "Cumilla", "Feni", "Khagrachhari", "Lakshmipur", "Noakhali", "Rangamati"],
  Rajshahi: ["Bogura", "Chapai Nawabganj", "Joypurhat", "Naogaon", "Natore", "Pabna", "Rajshahi", "Sirajganj"],
  Khulna: ["Bagerhat", "Chuadanga", "Jashore", "Jhenaidah", "Khulna", "Kushtia", "Magura", "Meherpur", "Narail", "Satkhira"],
  Barishal: ["Barguna", "Barishal", "Bhola", "Jhalokati", "Patuakhali", "Pirojpur"],
  Sylhet: ["Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"],
  Rangpur: ["Dinajpur", "Gaibandha", "Kurigram", "Lalmonirhat", "Nilphamari", "Panchagarh", "Rangpur", "Thakurgaon"],
  Mymensingh: ["Jamalpur", "Mymensingh", "Netrokona", "Sherpur"],
};

export const AREAS: Record<string, string[]> = {
  // Dhaka division
  Dhaka: [
    "Adabor", "Badda", "Banani", "Bangshal", "Cantonment", "Dakshinkhan", "Demra", "Dhamrai", "Dhanmondi", "Dohar", "Gulshan",
    "Hazaribagh", "Jatrabari", "Kadamtali", "Kafrul", "Kalabagan", "Kamrangirchar", "Keraniganj", "Khilgaon", "Khilkhet", "Kotwali",
    "Lalbagh", "Mirpur", "Mohammadpur", "Motijheel", "Nawabganj", "New Market", "Pallabi", "Paltan", "Ramna", "Rampura", "Sabujbagh",
    "Savar", "Shah Ali", "Shahbagh", "Sher-e-Bangla Nagar", "Shyampur", "Sutrapur", "Tejgaon", "Turag", "Uttara", "Uttarkhan", "Wari",
  ],
  Faridpur: ["Alfadanga", "Bhanga", "Boalmari", "Charbhadrasan", "Faridpur Sadar", "Madhukhali", "Nagarkanda", "Sadarpur", "Saltha"],
  Gazipur: ["Gazipur Sadar", "Kaliakair", "Kaliganj", "Kapasia", "Sreepur", "Tongi"],
  Gopalganj: ["Gopalganj Sadar", "Kashiani", "Kotalipara", "Muksudpur", "Tungipara"],
  Kishoreganj: ["Austagram", "Bajitpur", "Bhairab", "Hossainpur", "Itna", "Karimganj", "Katiadi", "Kishoreganj Sadar", "Kuliarchar", "Mithamain", "Nikli", "Pakundia", "Tarail"],
  Madaripur: ["Kalkini", "Madaripur Sadar", "Rajoir", "Shibchar"],
  Manikganj: ["Daulatpur", "Ghior", "Harirampur", "Manikganj Sadar", "Saturia", "Shivalaya", "Singair"],
  Munshiganj: ["Gazaria", "Lohajang", "Munshiganj Sadar", "Sirajdikhan", "Sreenagar", "Tongibari"],
  Narayanganj: ["Araihazar", "Bandar", "Fatullah", "Narayanganj Sadar", "Rupganj", "Siddhirganj", "Sonargaon"],
  Narsingdi: ["Belabo", "Monohardi", "Narsingdi Sadar", "Palash", "Raipura", "Shibpur"],
  Rajbari: ["Baliakandi", "Goalandaghat", "Kalukhali", "Pangsha", "Rajbari Sadar"],
  Shariatpur: ["Bhedarganj", "Damudya", "Gosairhat", "Naria", "Shakhipur", "Shariatpur Sadar", "Zajira"],
  Tangail: ["Basail", "Bhuapur", "Delduar", "Dhanbari", "Ghatail", "Gopalpur", "Kalihati", "Madhupur", "Mirzapur", "Nagarpur", "Sakhipur", "Tangail Sadar"],
  // Chattogram division
  Bandarban: ["Ali Kadam", "Bandarban Sadar", "Lama", "Naikhongchhari", "Rowangchhari", "Ruma", "Thanchi"],
  Brahmanbaria: ["Akhaura", "Ashuganj", "Bancharampur", "Bijoynagar", "Brahmanbaria Sadar", "Kasba", "Nabinagar", "Nasirnagar", "Sarail"],
  Chandpur: ["Chandpur Sadar", "Faridganj", "Haimchar", "Haziganj", "Kachua", "Matlab Dakshin", "Matlab Uttar", "Shahrasti"],
  Chattogram: ["Agrabad", "Anwara", "Bakalia", "Bandar", "Banshkhali", "Bayazid", "Bhujpur", "Boalkhali", "Chandanaish", "Chandgaon", "Double Mooring", "Fatikchhari", "Halishahar", "Hathazari", "Karnaphuli", "Khulshi", "Kotwali", "Lohagara", "Mirsharai", "Pahartali", "Panchlaish", "Patenga", "Patiya", "Rangunia", "Raozan", "Sandwip", "Satkania", "Sitakunda"],
  "Cox's Bazar": ["Chakaria", "Cox's Bazar Sadar", "Kutubdia", "Maheshkhali", "Matamuhuri", "Pekua", "Ramu", "Teknaf", "Ukhia"],
  Cumilla: ["Barura", "Brahmanpara", "Burichang", "Chandina", "Chauddagram", "Cumilla Adarsha Sadar", "Cumilla Sadar Dakshin", "Daudkandi", "Debidwar", "Homna", "Laksam", "Meghna", "Monohargonj", "Muradnagar", "Nangalkot", "Titas"],
  Feni: ["Chhagalnaiya", "Daganbhuiyan", "Feni Sadar", "Fulgazi", "Parshuram", "Sonagazi"],
  Khagrachhari: ["Dighinala", "Khagrachhari", "Lakshmichhari", "Mahalchhari", "Manikchhari", "Matiranga", "Panchhari", "Ramgarh"],
  Lakshmipur: ["Chandraganj", "Kamalnagar", "Lakshmipur Sadar", "Raipur", "Ramganj", "Ramgati"],
  Noakhali: ["Begumganj", "Chatkhil", "Companiganj", "Hatiya", "Kabirhat", "Noakhali Sadar", "Senbagh", "Sonaimuri", "Subarnachar"],
  Rangamati: ["Bagaichhari", "Barkal", "Belaichhari", "Juraichhari", "Kaptai", "Kawkhali (Betbunia)", "Langadu", "Naniyachar", "Rajasthali", "Rangamati Sadar"],
  // Rajshahi division
  Bogura: ["Adamdighi", "Bogura Sadar", "Dhunat", "Dhupchanchia", "Gabtali", "Kahaloo", "Mokamtola", "Nandigram", "Sariakandi", "Shajahanpur", "Sherpur", "Shibganj", "Sonatola"],
  "Chapai Nawabganj": ["Bholahat", "Gomastapur", "Nachole", "Nawabganj Sadar", "Shibganj"],
  Joypurhat: ["Akkelpur", "Joypurhat Sadar", "Kalai", "Khetlal", "Panchbibi"],
  Naogaon: ["Atrai", "Badalgachhi", "Dhamoirhat", "Manda", "Mohadevpur", "Naogaon Sadar", "Niamatpur", "Patnitala", "Porsha", "Raninagar", "Sapahar"],
  Natore: ["Bagatipara", "Baraigram", "Gurudaspur", "Lalpur", "Naldanga", "Natore Sadar", "Singra"],
  Pabna: ["Ataikula", "Atgharia", "Bera", "Bhangura", "Chatmohar", "Faridpur", "Ishwardi", "Pabna Sadar", "Santhia", "Sujanagar"],
  Rajshahi: ["Bagha", "Bagmara", "Charghat", "Durgapur", "Godagari", "Mohanpur", "Paba", "Puthia", "Tanore"],
  Sirajganj: ["Belkuchi", "Chauhali", "Kamarkhanda", "Kazipur", "Raiganj", "Shahjadpur", "Sirajganj Sadar", "Tarash", "Ullahpara"],
  // Khulna division
  Bagerhat: ["Bagerhat Sadar", "Chitalmari", "Fakirhat", "Kachua", "Mollahat", "Mongla", "Morrelganj", "Rampal", "Sarankhola"],
  Chuadanga: ["Alamdanga", "Chuadanga Sadar", "Damurhuda", "Jibannagar"],
  Jashore: ["Abhaynagar", "Bagherpara", "Chaugachha", "Jashore Sadar", "Jhikargachha", "Keshabpur", "Manirampur", "Sharsha"],
  Jhenaidah: ["Harinakunda", "Jhenaidah Sadar", "Kaliganj", "Kotchandpur", "Maheshpur", "Shailkupa"],
  Khulna: ["Batiaghata", "Dacope", "Daulatpur", "Dighalia", "Dumuria", "Harintana", "Khalishpur", "Khan Jahan Ali", "Kotwali", "Koyra", "Paikgachha", "Phultala", "Rupsha", "Sonadanga", "Terokhada"],
  Kushtia: ["Bheramara", "Daulatpur", "Khoksa", "Kumarkhali", "Kushtia Sadar", "Mirpur"],
  Magura: ["Magura Sadar", "Mohammadpur", "Shalikha", "Sreepur"],
  Meherpur: ["Gangni", "Meherpur Sadar", "Mujibnagar"],
  Narail: ["Kalia", "Lohagara", "Naragati", "Narail Sadar"],
  Satkhira: ["Assasuni", "Debhata", "Kalaroa", "Kaliganj", "Satkhira Sadar", "Shyamnagar", "Tala"],
  // Barishal division
  Barguna: ["Amtali", "Bamna", "Barguna Sadar", "Betagi", "Patharghata", "Taltali"],
  Barishal: ["Agailjhara", "Babuganj", "Bakerganj", "Banaripara", "Barishal Sadar", "Gaurnadi", "Hizla", "Mehendiganj", "Muladi", "Wazirpur"],
  Bhola: ["Bhola Sadar", "Burhanuddin", "Char Fasson", "Daulatkhan", "Lalmohan", "Manpura", "Tazumuddin"],
  Jhalokati: ["Jhalokati Sadar", "Kathalia", "Nalchity", "Rajapur"],
  Patuakhali: ["Bauphal", "Dashmina", "Dumki", "Galachipa", "Kalapara", "Mirzaganj", "Patuakhali Sadar", "Rangabali"],
  Pirojpur: ["Bhandaria", "Kawkhali", "Mathbaria", "Nazirpur", "Nesarabad (Swarupkati)", "Pirojpur Sadar", "Zianagar"],
  // Sylhet division
  Habiganj: ["Ajmiriganj", "Bahubal", "Baniyachong", "Chunarughat", "Habiganj Sadar", "Lakhai", "Madhabpur", "Nabiganj", "Sayestaganj"],
  Moulvibazar: ["Barlekha", "Juri", "Kamalganj", "Kulaura", "Moulvibazar Sadar", "Rajnagar", "Sreemangal"],
  Sunamganj: ["Bishwamvarpur", "Chhatak", "Dakshin Sunamganj", "Derai", "Dharamapasha", "Dowarabazar", "Jagannathpur", "Jamalganj", "Sullah", "Sunamganj Sadar", "Tahirpur"],
  Sylhet: ["Ambarkhana", "Balaganj", "Beanibazar", "Bishwanath", "Companiganj", "Dakshin Surma", "Fenchuganj", "Golapganj", "Gowainghat", "Jaintiapur", "Kanaighat", "Osmani Nagar", "Sylhet Sadar", "Zakiganj", "Zindabazar"],
  // Rangpur division
  Dinajpur: ["Biral", "Birampur", "Birganj", "Bochaganj", "Chirirbandar", "Dinajpur Sadar", "Ghoraghat", "Hakimpur", "Kaharole", "Khansama", "Nawabganj", "Parbatipur", "Phulbari"],
  Gaibandha: ["Gaibandha Sadar", "Gobindaganj", "Palashbari", "Phulchhari", "Sadullapur", "Sughatta", "Sundarganj"],
  Kurigram: ["Bhurungamari", "Char Rajibpur", "Chilmari", "Kurigram Sadar", "Nageshwari", "Phulbari", "Rajarhat", "Raomari", "Ulipur"],
  Lalmonirhat: ["Aditmari", "Hatibandha", "Kaliganj", "Lalmonirhat Sadar", "Patgram"],
  Nilphamari: ["Dimla", "Domar", "Jaldhaka", "Kishoreganj", "Nilphamari Sadar", "Saidpur"],
  Panchagarh: ["Atwari", "Boda", "Debiganj", "Panchagarh Sadar", "Tetulia"],
  Rangpur: ["Badarganj", "Gangachhara", "Kaunia", "Mithapukur", "Pirgachha", "Pirganj", "Rangpur Sadar", "Taraganj"],
  Thakurgaon: ["Baliadangi", "Bhully", "Haripur", "Pirganj", "Ranisankail", "Ruhia", "Thakurgaon Sadar"],
  // Mymensingh division
  Jamalpur: ["Baksiganj", "Dewanganj", "Islampur", "Jamalpur Sadar", "Madarganj", "Melandaha", "Sarishabari"],
  Mymensingh: ["Bhaluka", "Dhobaura", "Fulbaria", "Gaffargaon", "Gauripur", "Haluaghat", "Ishwarganj", "Muktagachha", "Mymensingh Sadar", "Nandail", "Phulpur", "Tara Khanda", "Trishal"],
  Netrokona: ["Atpara", "Barhatta", "Durgapur", "Kalmakanda", "Kendua", "Khaliajuri", "Madan", "Mohanganj", "Netrokona Sadar", "Purbadhala"],
  Sherpur: ["Jhenaigati", "Nakla", "Nalitabari", "Sherpur Sadar", "Sreebardi"],
};

/**
 * Bangla display names for the tables above. The English strings stay
 * the submitted values; these names only render inside brackets in the
 * checkout delivery-form selects, e.g. "Habiganj (হবিগঞ্জ)".
 *
 * Sources: the nuhil/bangladesh-geocode dataset (BBS geocodes + the
 * original 2019 collection; divisions/districts/upazilas JSON) for every
 * name it covers, matched district-by-district with documented spelling
 * aliases; the Bengali Wikipedia thana list
 * (বাংলাদেশের থানার তালিকা) for the city thanas and areas the upazila
 * dataset does not list, plus the May-2026 NICAR upazilas (Mokamtola,
 * Matamuhuri, Chandraganj, Ruhia, Bhully). Eight nuhil spellings are
 * overridden with the standard spelling shown by the thana list
 * (Bhuapur, Tetulia, Dhupchanchia, Burhanuddin, Osmani Nagar,
 * Lakshmichhari, Cumilla Sadar Dakshin, Goalandaghat). Two renamed
 * upazilas keep the Bangla rendering of the STORED English value,
 * not the new name: Zianagar (জিয়ানগর, now Indurkani) and Dakshin
 * Sunamganj (দক্ষিণ সুনামগঞ্জ, now Shantiganj). Coverage is asserted
 * by tests: 8 divisions, 64 districts, 560 areas, no gaps.
 */
export const DIVISION_BN: Record<string, string> = {
  Dhaka: "ঢাকা",
  Chattogram: "চট্টগ্রাম",
  Rajshahi: "রাজশাহী",
  Khulna: "খুলনা",
  Barishal: "বরিশাল",
  Sylhet: "সিলেট",
  Rangpur: "রংপুর",
  Mymensingh: "ময়মনসিংহ",
};

export const DISTRICT_BN: Record<string, string> = {
  Dhaka: "ঢাকা",
  Faridpur: "ফরিদপুর",
  Gazipur: "গাজীপুর",
  Gopalganj: "গোপালগঞ্জ",
  Kishoreganj: "কিশোরগঞ্জ",
  Madaripur: "মাদারীপুর",
  Manikganj: "মানিকগঞ্জ",
  Munshiganj: "মুন্সিগঞ্জ",
  Narayanganj: "নারায়ণগঞ্জ",
  Narsingdi: "নরসিংদী",
  Rajbari: "রাজবাড়ী",
  Shariatpur: "শরীয়তপুর",
  Tangail: "টাঙ্গাইল",
  Bandarban: "বান্দরবান",
  Brahmanbaria: "ব্রাহ্মণবাড়িয়া",
  Chandpur: "চাঁদপুর",
  Chattogram: "চট্টগ্রাম",
  "Cox's Bazar": "কক্সবাজার",
  Cumilla: "কুমিল্লা",
  Feni: "ফেনী",
  Khagrachhari: "খাগড়াছড়ি",
  Lakshmipur: "লক্ষ্মীপুর",
  Noakhali: "নোয়াখালী",
  Rangamati: "রাঙ্গামাটি",
  Bogura: "বগুড়া",
  "Chapai Nawabganj": "চাঁপাইনবাবগঞ্জ",
  Joypurhat: "জয়পুরহাট",
  Naogaon: "নওগাঁ",
  Natore: "নাটোর",
  Pabna: "পাবনা",
  Rajshahi: "রাজশাহী",
  Sirajganj: "সিরাজগঞ্জ",
  Bagerhat: "বাগেরহাট",
  Chuadanga: "চুয়াডাঙ্গা",
  Jashore: "যশোর",
  Jhenaidah: "ঝিনাইদহ",
  Khulna: "খুলনা",
  Kushtia: "কুষ্টিয়া",
  Magura: "মাগুরা",
  Meherpur: "মেহেরপুর",
  Narail: "নড়াইল",
  Satkhira: "সাতক্ষীরা",
  Barguna: "বরগুনা",
  Barishal: "বরিশাল",
  Bhola: "ভোলা",
  Jhalokati: "ঝালকাঠি",
  Patuakhali: "পটুয়াখালী",
  Pirojpur: "পিরোজপুর",
  Habiganj: "হবিগঞ্জ",
  Moulvibazar: "মৌলভীবাজার",
  Sunamganj: "সুনামগঞ্জ",
  Sylhet: "সিলেট",
  Dinajpur: "দিনাজপুর",
  Gaibandha: "গাইবান্ধা",
  Kurigram: "কুড়িগ্রাম",
  Lalmonirhat: "লালমনিরহাট",
  Nilphamari: "নীলফামারী",
  Panchagarh: "পঞ্চগড়",
  Rangpur: "রংপুর",
  Thakurgaon: "ঠাকুরগাঁও",
  Jamalpur: "জামালপুর",
  Mymensingh: "ময়মনসিংহ",
  Netrokona: "নেত্রকোণা",
  Sherpur: "শেরপুর",
};

export const AREA_BN: Record<string, Record<string, string>> = {
  // Dhaka division
  Dhaka: {
    Adabor: "আদাবর", Badda: "বাড্ডা", Banani: "বনানী", Bangshal: "বংশাল", Cantonment: "ক্যান্টনমেন্ট",
    Dakshinkhan: "দক্ষিণখান", Demra: "ডেমরা", Dhamrai: "ধামরাই", Dhanmondi: "ধানমন্ডি", Dohar: "দোহার",
    Gulshan: "গুলশান", Hazaribagh: "হাজারীবাগ", Jatrabari: "যাত্রাবাড়ী", Kadamtali: "কদমতলী", Kafrul: "কাফরুল",
    Kalabagan: "কলাবাগান", Kamrangirchar: "কামরাঙ্গীরচর", Keraniganj: "কেরাণীগঞ্জ", Khilgaon: "খিলগাঁও",
    Khilkhet: "খিলক্ষেত", Kotwali: "কোতোয়ালী", Lalbagh: "লালবাগ", Mirpur: "মিরপুর", Mohammadpur: "মোহাম্মদপুর",
    Motijheel: "মতিঝিল", Nawabganj: "নবাবগঞ্জ", "New Market": "নিউ মার্কেট", Pallabi: "পল্লবী", Paltan: "পল্টন",
    Ramna: "রমনা", Rampura: "রামপুরা", Sabujbagh: "সবুজবাগ", Savar: "সাভার", "Shah Ali": "শাহ আলী",
    Shahbagh: "শাহবাগ", "Sher-e-Bangla Nagar": "শেরে বাংলা নগর", Shyampur: "শ্যামপুর", Sutrapur: "সূত্রাপুর",
    Tejgaon: "তেজগাঁও", Turag: "তুরাগ", Uttara: "উত্তরা", Uttarkhan: "উত্তরখান", Wari: "ওয়ারী",
  },
  Faridpur: {
    Alfadanga: "আলফাডাঙ্গা", Bhanga: "ভাঙ্গা", Boalmari: "বোয়ালমারী", Charbhadrasan: "চরভদ্রাসন",
    "Faridpur Sadar": "ফরিদপুর সদর", Madhukhali: "মধুখালী", Nagarkanda: "নগরকান্দা", Sadarpur: "সদরপুর",
    Saltha: "সালথা",
  },
  Gazipur: {
    "Gazipur Sadar": "গাজীপুর সদর", Kaliakair: "কালিয়াকৈর", Kaliganj: "কালীগঞ্জ", Kapasia: "কাপাসিয়া",
    Sreepur: "শ্রীপুর", Tongi: "টঙ্গী",
  },
  Gopalganj: {
    "Gopalganj Sadar": "গোপালগঞ্জ সদর", Kashiani: "কাশিয়ানী", Kotalipara: "কোটালীপাড়া", Muksudpur: "মুকসুদপুর",
    Tungipara: "টুংগীপাড়া",
  },
  Kishoreganj: {
    Austagram: "অষ্টগ্রাম", Bajitpur: "বাজিতপুর", Bhairab: "ভৈরব", Hossainpur: "হোসেনপুর", Itna: "ইটনা",
    Karimganj: "করিমগঞ্জ", Katiadi: "কটিয়াদী", "Kishoreganj Sadar": "কিশোরগঞ্জ সদর", Kuliarchar: "কুলিয়ারচর",
    Mithamain: "মিঠামইন", Nikli: "নিকলী", Pakundia: "পাকুন্দিয়া", Tarail: "তাড়াইল",
  },
  Madaripur: {
    Kalkini: "কালকিনি", "Madaripur Sadar": "মাদারীপুর সদর", Rajoir: "রাজৈর", Shibchar: "শিবচর",
  },
  Manikganj: {
    Daulatpur: "দৌলতপুর", Ghior: "ঘিওর", Harirampur: "হরিরামপুর", "Manikganj Sadar": "মানিকগঞ্জ সদর",
    Saturia: "সাটুরিয়া", Shivalaya: "শিবালয়", Singair: "সিংগাইর",
  },
  Munshiganj: {
    Gazaria: "গজারিয়া", Lohajang: "লৌহজং", "Munshiganj Sadar": "মুন্সিগঞ্জ সদর", Sirajdikhan: "সিরাজদিখান",
    Sreenagar: "শ্রীনগর", Tongibari: "টংগীবাড়ি",
  },
  Narayanganj: {
    Araihazar: "আড়াইহাজার", Bandar: "বন্দর", Fatullah: "ফতুল্লা", "Narayanganj Sadar": "নারায়নগঞ্জ সদর",
    Rupganj: "রূপগঞ্জ", Siddhirganj: "সিদ্ধিরগঞ্জ", Sonargaon: "সোনারগাঁ",
  },
  Narsingdi: {
    Belabo: "বেলাবো", Monohardi: "মনোহরদী", "Narsingdi Sadar": "নরসিংদী সদর", Palash: "পলাশ", Raipura: "রায়পুরা",
    Shibpur: "শিবপুর",
  },
  Rajbari: {
    Baliakandi: "বালিয়াকান্দি", Goalandaghat: "গোয়ালন্দ ঘাট", Kalukhali: "কালুখালী", Pangsha: "পাংশা",
    "Rajbari Sadar": "রাজবাড়ী সদর",
  },
  Shariatpur: {
    Bhedarganj: "ভেদরগঞ্জ", Damudya: "ডামুড্যা", Gosairhat: "গোসাইরহাট", Naria: "নড়িয়া", Shakhipur: "সখিপুর",
    "Shariatpur Sadar": "শরিয়তপুর সদর", Zajira: "জাজিরা",
  },
  Tangail: {
    Basail: "বাসাইল", Bhuapur: "ভূঞাপুর", Delduar: "দেলদুয়ার", Dhanbari: "ধনবাড়ী", Ghatail: "ঘাটাইল",
    Gopalpur: "গোপালপুর", Kalihati: "কালিহাতী", Madhupur: "মধুপুর", Mirzapur: "মির্জাপুর", Nagarpur: "নাগরপুর",
    Sakhipur: "সখিপুর", "Tangail Sadar": "টাঙ্গাইল সদর",
  },
  // Chattogram division
  Bandarban: {
    "Ali Kadam": "আলীকদম", "Bandarban Sadar": "বান্দরবান সদর", Lama: "লামা", Naikhongchhari: "নাইক্ষ্যংছড়ি",
    Rowangchhari: "রোয়াংছড়ি", Ruma: "রুমা", Thanchi: "থানচি",
  },
  Brahmanbaria: {
    Akhaura: "আখাউড়া", Ashuganj: "আশুগঞ্জ", Bancharampur: "বাঞ্ছারামপুর", Bijoynagar: "বিজয়নগর",
    "Brahmanbaria Sadar": "ব্রাহ্মণবাড়িয়া সদর", Kasba: "কসবা", Nabinagar: "নবীনগর", Nasirnagar: "নাসিরনগর",
    Sarail: "সরাইল",
  },
  Chandpur: {
    "Chandpur Sadar": "চাঁদপুর সদর", Faridganj: "ফরিদগঞ্জ", Haimchar: "হাইমচর", Haziganj: "হাজীগঞ্জ",
    Kachua: "কচুয়া", "Matlab Dakshin": "মতলব দক্ষিণ", "Matlab Uttar": "মতলব উত্তর", Shahrasti: "শাহরাস্তি",
  },
  Chattogram: {
    Agrabad: "আগ্রাবাদ", Anwara: "আনোয়ারা", Bakalia: "বাকলিয়া", Bandar: "বন্দর", Banshkhali: "বাঁশখালী",
    Bayazid: "বায়েজিদ", Bhujpur: "ভূজপুর", Boalkhali: "বোয়ালখালী", Chandanaish: "চন্দনাইশ", Chandgaon: "চান্দগাঁও",
    "Double Mooring": "ডবলমুরিং", Fatikchhari: "ফটিকছড়ি", Halishahar: "হালিশহর", Hathazari: "হাটহাজারী",
    Karnaphuli: "কর্ণফুলী", Khulshi: "খুলশী", Kotwali: "কোতোয়ালী", Lohagara: "লোহাগাড়া", Mirsharai: "মীরসরাই",
    Pahartali: "পাহাড়তলী", Panchlaish: "পাঁচলাইশ", Patenga: "পতেঙ্গা", Patiya: "পটিয়া", Rangunia: "রাঙ্গুনিয়া",
    Raozan: "রাউজান", Sandwip: "সন্দ্বীপ", Satkania: "সাতকানিয়া", Sitakunda: "সীতাকুন্ড",
  },
  "Cox's Bazar": {
    Chakaria: "চকরিয়া", "Cox's Bazar Sadar": "কক্সবাজার সদর", Kutubdia: "কুতুবদিয়া", Maheshkhali: "মহেশখালী",
    Matamuhuri: "মাতামুহুরী", Pekua: "পেকুয়া", Ramu: "রামু", Teknaf: "টেকনাফ", Ukhia: "উখিয়া",
  },
  Cumilla: {
    Barura: "বরুড়া", Brahmanpara: "ব্রাহ্মণপাড়া", Burichang: "বুড়িচং", Chandina: "চান্দিনা",
    Chauddagram: "চৌদ্দগ্রাম", "Cumilla Adarsha Sadar": "কুমিল্লা আদর্শ সদর",
    "Cumilla Sadar Dakshin": "কুমিল্লা সদর দক্ষিণ", Daudkandi: "দাউদকান্দি", Debidwar: "দেবিদ্বার", Homna: "হোমনা",
    Laksam: "লাকসাম", Meghna: "মেঘনা", Monohargonj: "মনোহরগঞ্জ", Muradnagar: "মুরাদনগর", Nangalkot: "নাঙ্গলকোট",
    Titas: "তিতাস",
  },
  Feni: {
    Chhagalnaiya: "ছাগলনাইয়া", Daganbhuiyan: "দাগনভূঞা", "Feni Sadar": "ফেনী সদর", Fulgazi: "ফুলগাজী",
    Parshuram: "পরশুরাম", Sonagazi: "সোনাগাজী",
  },
  Khagrachhari: {
    Dighinala: "দিঘীনালা", Khagrachhari: "খাগড়াছড়ি সদর", Lakshmichhari: "লক্ষ্মীছড়ি", Mahalchhari: "মহালছড়ি",
    Manikchhari: "মানিকছড়ি", Matiranga: "মাটিরাঙ্গা", Panchhari: "পানছড়ি", Ramgarh: "রামগড়",
  },
  Lakshmipur: {
    Chandraganj: "চন্দ্রগঞ্জ", Kamalnagar: "কমলনগর", "Lakshmipur Sadar": "লক্ষ্মীপুর সদর", Raipur: "রায়পুর",
    Ramganj: "রামগঞ্জ", Ramgati: "রামগতি",
  },
  Noakhali: {
    Begumganj: "বেগমগঞ্জ", Chatkhil: "চাটখিল", Companiganj: "কোম্পানীগঞ্জ", Hatiya: "হাতিয়া", Kabirhat: "কবিরহাট",
    "Noakhali Sadar": "নোয়াখালী সদর", Senbagh: "সেনবাগ", Sonaimuri: "সোনাইমুড়ী", Subarnachar: "সুবর্ণচর",
  },
  Rangamati: {
    Bagaichhari: "বাঘাইছড়ি", Barkal: "বরকল", Belaichhari: "বিলাইছড়ি", Juraichhari: "জুরাছড়ি", Kaptai: "কাপ্তাই",
    "Kawkhali (Betbunia)": "কাউখালী", Langadu: "লংগদু", Naniyachar: "নানিয়ারচর", Rajasthali: "রাজস্থলী",
    "Rangamati Sadar": "রাঙ্গামাটি সদর",
  },
  // Rajshahi division
  Bogura: {
    Adamdighi: "আদমদিঘি", "Bogura Sadar": "বগুড়া সদর", Dhunat: "ধুনট", Dhupchanchia: "দুপচাঁচিয়া",
    Gabtali: "গাবতলী", Kahaloo: "কাহালু", Mokamtola: "মোকামতলা", Nandigram: "নন্দিগ্রাম", Sariakandi: "সারিয়াকান্দি",
    Shajahanpur: "শাজাহানপুর", Sherpur: "শেরপুর", Shibganj: "শিবগঞ্জ", Sonatola: "সোনাতলা",
  },
  "Chapai Nawabganj": {
    Bholahat: "ভোলাহাট", Gomastapur: "গোমস্তাপুর", Nachole: "নাচোল", "Nawabganj Sadar": "চাঁপাইনবাবগঞ্জ সদর",
    Shibganj: "শিবগঞ্জ",
  },
  Joypurhat: {
    Akkelpur: "আক্কেলপুর", "Joypurhat Sadar": "জয়পুরহাট সদর", Kalai: "কালাই", Khetlal: "ক্ষেতলাল",
    Panchbibi: "পাঁচবিবি",
  },
  Naogaon: {
    Atrai: "আত্রাই", Badalgachhi: "বদলগাছী", Dhamoirhat: "ধামইরহাট", Manda: "মান্দা", Mohadevpur: "মহাদেবপুর",
    "Naogaon Sadar": "নওগাঁ সদর", Niamatpur: "নিয়ামতপুর", Patnitala: "পত্নিতলা", Porsha: "পোরশা",
    Raninagar: "রাণীনগর", Sapahar: "সাপাহার",
  },
  Natore: {
    Bagatipara: "বাগাতিপাড়া", Baraigram: "বড়াইগ্রাম", Gurudaspur: "গুরুদাসপুর", Lalpur: "লালপুর",
    Naldanga: "নলডাঙ্গা", "Natore Sadar": "নাটোর সদর", Singra: "সিংড়া",
  },
  Pabna: {
    Ataikula: "আতাইকুলা", Atgharia: "আটঘরিয়া", Bera: "বেড়া", Bhangura: "ভাঙ্গুড়া", Chatmohar: "চাটমোহর",
    Faridpur: "ফরিদপুর", Ishwardi: "ঈশ্বরদী", "Pabna Sadar": "পাবনা সদর", Santhia: "সাঁথিয়া", Sujanagar: "সুজানগর",
  },
  Rajshahi: {
    Bagha: "বাঘা", Bagmara: "বাগমারা", Charghat: "চারঘাট", Durgapur: "দুর্গাপুর", Godagari: "গোদাগাড়ী",
    Mohanpur: "মোহনপুর", Paba: "পবা", Puthia: "পুঠিয়া", Tanore: "তানোর",
  },
  Sirajganj: {
    Belkuchi: "বেলকুচি", Chauhali: "চৌহালি", Kamarkhanda: "কামারখন্দ", Kazipur: "কাজীপুর", Raiganj: "রায়গঞ্জ",
    Shahjadpur: "শাহজাদপুর", "Sirajganj Sadar": "সিরাজগঞ্জ সদর", Tarash: "তাড়াশ", Ullahpara: "উল্লাপাড়া",
  },
  // Khulna division
  Bagerhat: {
    "Bagerhat Sadar": "বাগেরহাট সদর", Chitalmari: "চিতলমারী", Fakirhat: "ফকিরহাট", Kachua: "কচুয়া",
    Mollahat: "মোল্লাহাট", Mongla: "মোংলা", Morrelganj: "মোড়েলগঞ্জ", Rampal: "রামপাল", Sarankhola: "শরণখোলা",
  },
  Chuadanga: {
    Alamdanga: "আলমডাঙ্গা", "Chuadanga Sadar": "চুয়াডাঙ্গা সদর", Damurhuda: "দামুড়হুদা", Jibannagar: "জীবননগর",
  },
  Jashore: {
    Abhaynagar: "অভয়নগর", Bagherpara: "বাঘারপাড়া", Chaugachha: "চৌগাছা", "Jashore Sadar": "যশোর সদর",
    Jhikargachha: "ঝিকরগাছা", Keshabpur: "কেশবপুর", Manirampur: "মণিরামপুর", Sharsha: "শার্শা",
  },
  Jhenaidah: {
    Harinakunda: "হরিণাকুন্ডু", "Jhenaidah Sadar": "ঝিনাইদহ সদর", Kaliganj: "কালীগঞ্জ", Kotchandpur: "কোটচাঁদপুর",
    Maheshpur: "মহেশপুর", Shailkupa: "শৈলকুপা",
  },
  Khulna: {
    Batiaghata: "বটিয়াঘাটা", Dacope: "দাকোপ", Daulatpur: "দৌলতপুর", Dighalia: "দিঘলিয়া", Dumuria: "ডুমুরিয়া",
    Harintana: "হরিণটানা", Khalishpur: "খালিশপুর", "Khan Jahan Ali": "খানজাহান আলী", Kotwali: "কোতোয়ালী",
    Koyra: "কয়রা", Paikgachha: "পাইকগাছা", Phultala: "ফুলতলা", Rupsha: "রূপসা", Sonadanga: "সোনাডাঙ্গা",
    Terokhada: "তেরখাদা",
  },
  Kushtia: {
    Bheramara: "ভেড়ামারা", Daulatpur: "দৌলতপুর", Khoksa: "খোকসা", Kumarkhali: "কুমারখালী",
    "Kushtia Sadar": "কুষ্টিয়া সদর", Mirpur: "মিরপুর",
  },
  Magura: {
    "Magura Sadar": "মাগুরা সদর", Mohammadpur: "মহম্মদপুর", Shalikha: "শালিখা", Sreepur: "শ্রীপুর",
  },
  Meherpur: {
    Gangni: "গাংনী", "Meherpur Sadar": "মেহেরপুর সদর", Mujibnagar: "মুজিবনগর",
  },
  Narail: {
    Kalia: "কালিয়া", Lohagara: "লোহাগড়া", Naragati: "নড়াগাতী", "Narail Sadar": "নড়াইল সদর",
  },
  Satkhira: {
    Assasuni: "আশাশুনি", Debhata: "দেবহাটা", Kalaroa: "কলারোয়া", Kaliganj: "কালিগঞ্জ",
    "Satkhira Sadar": "সাতক্ষীরা সদর", Shyamnagar: "শ্যামনগর", Tala: "তালা",
  },
  // Barishal division
  Barguna: {
    Amtali: "আমতলী", Bamna: "বামনা", "Barguna Sadar": "বরগুনা সদর", Betagi: "বেতাগী", Patharghata: "পাথরঘাটা",
    Taltali: "তালতলি",
  },
  Barishal: {
    Agailjhara: "আগৈলঝাড়া", Babuganj: "বাবুগঞ্জ", Bakerganj: "বাকেরগঞ্জ", Banaripara: "বানারীপাড়া",
    "Barishal Sadar": "বরিশাল সদর", Gaurnadi: "গৌরনদী", Hizla: "হিজলা", Mehendiganj: "মেহেন্দিগঞ্জ",
    Muladi: "মুলাদী", Wazirpur: "উজিরপুর",
  },
  Bhola: {
    "Bhola Sadar": "ভোলা সদর", Burhanuddin: "বোরহানউদ্দিন", "Char Fasson": "চরফ্যাশন", Daulatkhan: "দৌলতখান",
    Lalmohan: "লালমোহন", Manpura: "মনপুরা", Tazumuddin: "তজুমদ্দিন",
  },
  Jhalokati: {
    "Jhalokati Sadar": "ঝালকাঠি সদর", Kathalia: "কাঠালিয়া", Nalchity: "নলছিটি", Rajapur: "রাজাপুর",
  },
  Patuakhali: {
    Bauphal: "বাউফল", Dashmina: "দশমিনা", Dumki: "দুমকি", Galachipa: "গলাচিপা", Kalapara: "কলাপাড়া",
    Mirzaganj: "মির্জাগঞ্জ", "Patuakhali Sadar": "পটুয়াখালী সদর", Rangabali: "রাঙ্গাবালী",
  },
  Pirojpur: {
    Bhandaria: "ভান্ডারিয়া", Kawkhali: "কাউখালী", Mathbaria: "মঠবাড়ীয়া", Nazirpur: "নাজিরপুর",
    "Nesarabad (Swarupkati)": "নেছারাবাদ", "Pirojpur Sadar": "পিরোজপুর সদর", Zianagar: "জিয়ানগর",
  },
  // Sylhet division
  Habiganj: {
    Ajmiriganj: "আজমিরীগঞ্জ", Bahubal: "বাহুবল", Baniyachong: "বানিয়াচং", Chunarughat: "চুনারুঘাট",
    "Habiganj Sadar": "হবিগঞ্জ সদর", Lakhai: "লাখাই", Madhabpur: "মাধবপুর", Nabiganj: "নবীগঞ্জ",
    Sayestaganj: "শায়েস্তাগঞ্জ",
  },
  Moulvibazar: {
    Barlekha: "বড়লেখা", Juri: "জুড়ী", Kamalganj: "কমলগঞ্জ", Kulaura: "কুলাউড়া",
    "Moulvibazar Sadar": "মৌলভীবাজার সদর", Rajnagar: "রাজনগর", Sreemangal: "শ্রীমঙ্গল",
  },
  Sunamganj: {
    Bishwamvarpur: "বিশ্বম্ভরপুর", Chhatak: "ছাতক", "Dakshin Sunamganj": "দক্ষিণ সুনামগঞ্জ", Derai: "দিরাই",
    Dharamapasha: "ধর্মপাশা", Dowarabazar: "দোয়ারাবাজার", Jagannathpur: "জগন্নাথপুর", Jamalganj: "জামালগঞ্জ",
    Sullah: "শাল্লা", "Sunamganj Sadar": "সুনামগঞ্জ সদর", Tahirpur: "তাহিরপুর",
  },
  Sylhet: {
    Ambarkhana: "আম্বরখানা", Balaganj: "বালাগঞ্জ", Beanibazar: "বিয়ানীবাজার", Bishwanath: "বিশ্বনাথ",
    Companiganj: "কোম্পানীগঞ্জ", "Dakshin Surma": "দক্ষিণ সুরমা", Fenchuganj: "ফেঞ্চুগঞ্জ", Golapganj: "গোলাপগঞ্জ",
    Gowainghat: "গোয়াইনঘাট", Jaintiapur: "জৈন্তাপুর", Kanaighat: "কানাইঘাট", "Osmani Nagar": "ওসমানীনগর",
    "Sylhet Sadar": "সিলেট সদর", Zakiganj: "জকিগঞ্জ", Zindabazar: "জিন্দাবাজার",
  },
  // Rangpur division
  Dinajpur: {
    Biral: "বিরল", Birampur: "বিরামপুর", Birganj: "বীরগঞ্জ", Bochaganj: "বোচাগঞ্জ", Chirirbandar: "চিরিরবন্দর",
    "Dinajpur Sadar": "দিনাজপুর সদর", Ghoraghat: "ঘোড়াঘাট", Hakimpur: "হাকিমপুর", Kaharole: "কাহারোল",
    Khansama: "খানসামা", Nawabganj: "নবাবগঞ্জ", Parbatipur: "পার্বতীপুর", Phulbari: "ফুলবাড়ী",
  },
  Gaibandha: {
    "Gaibandha Sadar": "গাইবান্ধা সদর", Gobindaganj: "গোবিন্দগঞ্জ", Palashbari: "পলাশবাড়ী", Phulchhari: "ফুলছড়ি",
    Sadullapur: "সাদুল্লাপুর", Sughatta: "সাঘাটা", Sundarganj: "সুন্দরগঞ্জ",
  },
  Kurigram: {
    Bhurungamari: "ভুরুঙ্গামারী", "Char Rajibpur": "চর রাজিবপুর", Chilmari: "চিলমারী",
    "Kurigram Sadar": "কুড়িগ্রাম সদর", Nageshwari: "নাগেশ্বরী", Phulbari: "ফুলবাড়ী", Rajarhat: "রাজারহাট",
    Raomari: "রৌমারী", Ulipur: "উলিপুর",
  },
  Lalmonirhat: {
    Aditmari: "আদিতমারী", Hatibandha: "হাতীবান্ধা", Kaliganj: "কালীগঞ্জ", "Lalmonirhat Sadar": "লালমনিরহাট সদর",
    Patgram: "পাটগ্রাম",
  },
  Nilphamari: {
    Dimla: "ডিমলা", Domar: "ডোমার", Jaldhaka: "জলঢাকা", Kishoreganj: "কিশোরগঞ্জ",
    "Nilphamari Sadar": "নীলফামারী সদর", Saidpur: "সৈয়দপুর",
  },
  Panchagarh: {
    Atwari: "আটোয়ারী", Boda: "বোদা", Debiganj: "দেবীগঞ্জ", "Panchagarh Sadar": "পঞ্চগড় সদর", Tetulia: "তেঁতুলিয়া",
  },
  Rangpur: {
    Badarganj: "বদরগঞ্জ", Gangachhara: "গংগাচড়া", Kaunia: "কাউনিয়া", Mithapukur: "মিঠাপুকুর", Pirgachha: "পীরগাছা",
    Pirganj: "পীরগঞ্জ", "Rangpur Sadar": "রংপুর সদর", Taraganj: "তারাগঞ্জ",
  },
  Thakurgaon: {
    Baliadangi: "বালিয়াডাঙ্গী", Bhully: "ভূল্লী", Haripur: "হরিপুর", Pirganj: "পীরগঞ্জ", Ranisankail: "রাণীশংকৈল",
    Ruhia: "রুহিয়া", "Thakurgaon Sadar": "ঠাকুরগাঁও সদর",
  },
  // Mymensingh division
  Jamalpur: {
    Baksiganj: "বকশীগঞ্জ", Dewanganj: "দেওয়ানগঞ্জ", Islampur: "ইসলামপুর", "Jamalpur Sadar": "জামালপুর সদর",
    Madarganj: "মাদারগঞ্জ", Melandaha: "মেলান্দহ", Sarishabari: "সরিষাবাড়ী",
  },
  Mymensingh: {
    Bhaluka: "ভালুকা", Dhobaura: "ধোবাউড়া", Fulbaria: "ফুলবাড়ীয়া", Gaffargaon: "গফরগাঁও", Gauripur: "গৌরীপুর",
    Haluaghat: "হালুয়াঘাট", Ishwarganj: "ঈশ্বরগঞ্জ", Muktagachha: "মুক্তাগাছা", "Mymensingh Sadar": "ময়মনসিংহ সদর",
    Nandail: "নান্দাইল", Phulpur: "ফুলপুর", "Tara Khanda": "তারাকান্দা", Trishal: "ত্রিশাল",
  },
  Netrokona: {
    Atpara: "আটপাড়া", Barhatta: "বারহাট্টা", Durgapur: "দুর্গাপুর", Kalmakanda: "কলমাকান্দা", Kendua: "কেন্দুয়া",
    Khaliajuri: "খালিয়াজুরী", Madan: "মদন", Mohanganj: "মোহনগঞ্জ", "Netrokona Sadar": "নেত্রকোণা সদর",
    Purbadhala: "পূর্বধলা",
  },
  Sherpur: {
    Jhenaigati: "ঝিনাইগাতী", Nakla: "নকলা", Nalitabari: "নালিতাবাড়ী", "Sherpur Sadar": "শেরপুর সদর",
    Sreebardi: "শ্রীবরদী",
  },
};

/** Bilingual select label: "Habiganj (হবিগঞ্জ)". Falls back to the
 * English name alone if a Bangla name is ever missing, so a data gap
 * can never render empty brackets. Submitted values are unaffected. */
export function divisionLabel(division: string): string {
  const bn = DIVISION_BN[division];
  return bn ? `${division} (${bn})` : division;
}

export function districtLabel(district: string): string {
  const bn = DISTRICT_BN[district];
  return bn ? `${district} (${bn})` : district;
}

export function areaLabel(district: string, area: string): string {
  const bn = AREA_BN[district]?.[area];
  return bn ? `${area} (${bn})` : area;
}

export const divisionNames = Object.keys(DIVISIONS);

export function districtsOf(division: string): string[] {
  return DIVISIONS[division] ?? [];
}

export function areasOf(district: string): string[] {
  return AREAS[district] ?? [];
}

/** Delivery is "inside Dhaka" only for Dhaka district. */
export function isInsideDhaka(district: string): boolean {
  return district === "Dhaka";
}
