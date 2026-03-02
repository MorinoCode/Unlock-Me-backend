import mongoose from 'mongoose';
const cleanDatabase = async () => {
    try {
        // HATMAN URL e DB asli ro inja bezar
        await mongoose.connect('mongodb+srv://MortezaAdmin:Fariba0743@cluster0.4teywuh.mongodb.net/unlockme?retryWrites=true&w=majority'); 
        const collectionsToEmpty = [
            'messages',
            'likes',
            'posts',
            'conversations',
            'notifications',
            'blindsessions', // <-- Fix shod
            'comments',
            'deletionrequests',
            'godateapplies',
            'godates',
            'paymentlogs',
            'reports' // <-- Ezafe shod
        ];
        for (const col of collectionsToEmpty) {
            console.log(`Clearing ${col}...`);
            await mongoose.connection.db.collection(col).deleteMany({});
        }
        console.log("Clearing fake users...");
        const result = await mongoose.connection.db.collection('users').deleteMany({
            _id: { $ne: new mongoose.Types.ObjectId('699db62de30052a1589cb1e0') }
        });
        console.log(`Deleted ${result.deletedCount} fake users.`);
        console.log("Database cleared successfully!");
        
        process.exit(0);
    } catch (error) {
        console.error("Error cleaning database:", error);
        process.exit(1);
    }
};
cleanDatabase();