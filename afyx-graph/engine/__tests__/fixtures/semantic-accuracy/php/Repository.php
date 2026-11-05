<?php
namespace App\Data;

class UserRepository {
    public static function findById(int $id): ?string {
        return "user";
    }
}

class UserService {
    public function get(int $id): ?string {
        return UserRepository::findById($id);
    }
}

